mod options;

use std::sync::Arc;
use std::sync::RwLock;
use std::time::Duration;

use crate::err::err_map;
use dashmap::DashMap;
use napi::bindgen_prelude::*;
use napi::tokio::sync::RwLock as TokioRwLock;
use napi_derive::napi;

use options::Options;
use serde_json::from_value;
use serde_json::Value as JsValue;
use surrealdb_core::dbs::Session;
use surrealdb_core::kvs::export::Config;
use surrealdb_core::kvs::Datastore;
use surrealdb_core::kvs::LockType;
use surrealdb_core::kvs::Transaction;
use surrealdb_core::kvs::TransactionType;
use surrealdb_core::rpc::format::cbor;
use surrealdb_core::rpc::DbResult;
use surrealdb_core::rpc::Request;

use surrealdb_core::rpc::RpcProtocol;
use surrealdb_types::Array;
use surrealdb_types::HashMap;
use surrealdb_types::Value;
use uuid::Uuid;

#[napi]
pub struct SurrealNodeEngine(TokioRwLock<Option<SurrealNodeConnection>>);

#[napi]
pub struct NotificationReceiver {
	receiver: channel::Receiver<Uint8Array>,
}

#[napi]
impl NotificationReceiver {
	#[napi]
	pub async fn recv(&self) -> std::result::Result<Option<Uint8Array>, Error> {
		match self.receiver.recv().await {
			Ok(data) => Ok(Some(data)),
			Err(_) => Ok(None), // Channel closed
		}
	}
}

#[napi]
impl SurrealNodeEngine {
	#[napi]
	pub async fn execute(&self, data: Uint8Array) -> std::result::Result<Uint8Array, Error> {
		let lock = self.0.read().await;
		let engine = lock.as_ref().unwrap();
		let obj = cbor::decode(data.to_vec().as_slice())
			.map_err(err_map)?
			.into_object()
			.map_err(err_map)?;
		let req = Request::from_object(obj).map_err(err_map)?;
		let res = RpcProtocol::execute(
			engine,
			req.txn.map(Into::into),
			req.session_id.map(Into::into),
			req.method,
			req.params,
		)
		.await;

		match res {
			Ok(result) => {
				let value = Value::from_t(result);
				let out = cbor::encode(value).map_err(err_map)?;
				Ok(out.as_slice().into())
			}
			Err(rpc_err) => {
				let mut envelope = surrealdb_types::Object::default();
				envelope.insert("error".to_string(), Value::from_t(rpc_err));
				let out = cbor::encode(Value::Object(envelope)).map_err(err_map)?;
				Ok(out.as_slice().into())
			}
		}
	}

	#[napi]
	pub async fn notifications(&self) -> std::result::Result<NotificationReceiver, Error> {
		let stream = {
			let lock = self.0.read().await;
			let engine = lock.as_ref().unwrap();

			engine
				.kvs
				.notifications()
				.ok_or_else(|| {
					Error::new(napi::Status::GenericFailure, "Notifications not enabled")
				})
				.map_err(err_map)?
		};

		let (tx, rx) = channel::unbounded();

		// Spawn a task to process notifications
		napi::tokio::spawn(async move {
			let notification_stream = stream;

			while let Ok(notification) = notification_stream.recv().await {
				let message = Value::from_t(notification);

				if let Ok(out) = cbor::encode(message) {
					let data = out.as_slice().into();
					if tx.send(data).await.is_err() {
						break; // Receiver dropped
					}
				}
			}
		});

		Ok(NotificationReceiver {
			receiver: rx,
		})
	}

	#[napi]
	pub async fn connect(
		endpoint: String,
		#[napi(ts_arg_type = "ConnectionOptions")] opts: Option<JsValue>,
	) -> std::result::Result<SurrealNodeEngine, Error> {
		let endpoint = match &endpoint {
			s if s.starts_with("mem:") => "memory",
			s => s,
		};

		let opts: Option<Options> = from_value::<Option<Options>>(JsValue::from(opts))?;
		let defaults = opts.as_ref().and_then(|o| o.defaults.clone()).unwrap_or_default();

		let kvs = Datastore::new(endpoint).await.map_err(err_map)?.with_notifications();
		let kvs = match opts {
			None => kvs,
			Some(opts) => kvs
				.with_capabilities(
					opts.capabilities.map_or(Ok(Default::default()), |a| a.try_into())?,
				)
				.with_transaction_timeout(
					opts.transaction_timeout.map(|qt| Duration::from_secs(qt as u64)),
				)
				.with_query_timeout(opts.query_timeout.map(|qt| Duration::from_secs(qt as u64))),
		};

		let (_, is_new) = kvs.check_version().await.map_err(err_map)?;

		if is_new {
			if let Some(defaults) = defaults.get_defaults() {
				kvs.initialise_defaults(&defaults.0, &defaults.1).await.map_err(err_map)?;
			}
		}

		let session = Session::default().with_rt(true);
		#[allow(unused_mut)]
		let mut sessions = HashMap::new();
		sessions.insert(None, Arc::new(TokioRwLock::new(session)));

		let connection = SurrealNodeConnection {
			kvs: Arc::new(kvs),
			live_queries: Arc::new(RwLock::new(HashMap::new())),
			transactions: DashMap::new(),
			sessions,
		};

		Ok(SurrealNodeEngine(TokioRwLock::new(Some(connection))))
	}

	#[napi]
	pub async fn export(&self, config: Option<Uint8Array>) -> std::result::Result<String, Error> {
		let lock = self.0.read().await;
		let engine = lock.as_ref().unwrap();
		let (tx, rx) = channel::unbounded();
		let session_arc = engine.default_session();
		let session_guard = session_arc.read().await;

		match config {
			Some(config) => {
				let in_config = cbor::decode(config.to_vec().as_slice()).map_err(err_map)?;
				let config = in_config.into_t::<Config>().map_err(err_map)?;
				engine
					.kvs
					.export_with_config(&*session_guard, tx, config)
					.await
					.map_err(err_map)?
					.await
					.map_err(err_map)?;
			}
			None => {
				engine
					.kvs
					.export(&*session_guard, tx)
					.await
					.map_err(err_map)?
					.await
					.map_err(err_map)?;
			}
		};

		let mut buffer = Vec::new();
		while let Ok(item) = rx.try_recv() {
			buffer.push(item);
		}

		let result = String::from_utf8(buffer.concat().into()).map_err(err_map)?;

		Ok(result)
	}

	#[napi]
	pub async fn import(&self, input: String) -> std::result::Result<(), Error> {
		let lock = self.0.read().await;
		let engine = lock.as_ref().unwrap();
		let session_arc = engine.default_session();
		let session_guard = session_arc.read().await;
		engine.kvs.import(&input, &*session_guard).await.map_err(err_map)?;

		Ok(())
	}

	#[napi]
	pub fn version() -> std::result::Result<String, Error> {
		Ok(env!("SURREALDB_VERSION").into())
	}

	#[napi]
	pub async fn free(&self) {
		let _inner_opt = self.0.write().await.take();
	}
}

struct SurrealNodeConnection {
	pub kvs: Arc<Datastore>,
	pub live_queries: Arc<RwLock<HashMap<Uuid, Option<Uuid>>>>,
	pub transactions: DashMap<Uuid, Arc<Transaction>>,
	pub sessions: HashMap<Option<Uuid>, Arc<napi::tokio::sync::RwLock<Session>>>,
}

impl SurrealNodeConnection {
	fn default_session(&self) -> Arc<napi::tokio::sync::RwLock<Session>> {
		self.sessions.get(&None).unwrap().clone()
	}
}

type TxError = surrealdb_types::Error;
type TxResult<T> = std::result::Result<T, TxError>;

impl RpcProtocol for SurrealNodeConnection {
	fn kvs(&self) -> &Datastore {
		&self.kvs
	}

	fn version_data(&self) -> DbResult {
		DbResult::Other(Value::String(format!("surrealdb-{}", env!("SURREALDB_VERSION"))))
	}

	/// A pointer to all active sessions
	fn session_map(&self) -> &HashMap<Option<Uuid>, Arc<napi::tokio::sync::RwLock<Session>>> {
		&self.sessions
	}

	const LQ_SUPPORT: bool = true;

	/// Handles the cleanup of live queries
	async fn cleanup_lqs(&self, session_id: Option<&Uuid>) {
		let mut gc = Vec::new();
		{
			let guard = self.live_queries.write().unwrap();
			guard.retain(|key, value| {
				if value.as_ref() == session_id {
					gc.push(*key);
					return false;
				}
				true
			});
		}
		let _ = self.kvs.delete_queries(gc).await;
	}

	/// Handles the cleanup of live queries
	async fn cleanup_all_lqs(&self) {
		let mut gc = Vec::new();
		{
			let guard = self.live_queries.write().unwrap();
			guard.retain(|key, _| {
				gc.push(*key);
				false
			});
		}
		let _ = self.kvs.delete_queries(gc).await;
	}

	async fn handle_live(&self, lqid: &Uuid, session_id: Option<Uuid>) {
		let live_queries = Arc::clone(&self.live_queries);
		let lqid = *lqid;
		live_queries.write().unwrap().insert(lqid, session_id);
	}

	async fn handle_kill(&self, lqid: &Uuid) {
		let live_queries = Arc::clone(&self.live_queries);
		let lqid = *lqid;
		live_queries.write().unwrap().remove(&lqid);
	}

	// ------------------------------
	// Transactions
	// ------------------------------

	/// Retrieves a transaction by ID
	async fn get_tx(&self, id: Uuid) -> TxResult<Arc<surrealdb_core::kvs::Transaction>> {
		self.transactions
			.get(&id)
			.map(|tx| tx.clone())
			.ok_or_else(|| surrealdb_core::rpc::invalid_params("Transaction not found"))
	}

	/// Stores a transaction
	async fn set_tx(&self, id: Uuid, tx: Arc<surrealdb_core::kvs::Transaction>) -> TxResult<()> {
		self.transactions.insert(id, tx);
		Ok(())
	}

	// ------------------------------
	// Methods for transactions
	// ------------------------------

	/// Begin a new transaction
	async fn begin(&self, _txn: Option<Uuid>, _session_id: Option<Uuid>) -> TxResult<DbResult> {
		// Create a new transaction
		let tx = self
			.kvs()
			.transaction(TransactionType::Write, LockType::Optimistic)
			.await
			.map_err(surrealdb_core::rpc::types_error_from_anyhow)?;
		// Generate a unique transaction ID
		let id = Uuid::now_v7();
		// Store the transaction in the map
		self.transactions.insert(id, Arc::new(tx));
		// Return the transaction ID to the client
		Ok(DbResult::Other(Value::Uuid(surrealdb_types::Uuid::from(id))))
	}

	/// Commit a transaction
	async fn commit(
		&self,
		_txn: Option<Uuid>,
		_session_id: Option<Uuid>,
		params: Array,
	) -> TxResult<DbResult> {
		let mut params_vec = params.into_vec();
		let Some(Value::Uuid(txn_id)) = params_vec.pop() else {
			return Err(surrealdb_core::rpc::invalid_params("Expected transaction UUID"));
		};
		let txn_id = txn_id.into_inner();
		let Some((_, tx)) = self.transactions.remove(&txn_id) else {
			return Err(surrealdb_core::rpc::invalid_params("Transaction not found"));
		};
		tx.commit().await.map_err(surrealdb_core::rpc::types_error_from_anyhow)?;
		Ok(DbResult::Other(Value::None))
	}

	/// Cancel a transaction
	async fn cancel(
		&self,
		_txn: Option<Uuid>,
		_session_id: Option<Uuid>,
		params: Array,
	) -> TxResult<DbResult> {
		let mut params_vec = params.into_vec();
		let Some(Value::Uuid(txn_id)) = params_vec.pop() else {
			return Err(surrealdb_core::rpc::invalid_params("Expected transaction UUID"));
		};
		let txn_id = txn_id.into_inner();
		let Some((_, tx)) = self.transactions.remove(&txn_id) else {
			return Err(surrealdb_core::rpc::invalid_params("Transaction not found"));
		};
		tx.cancel().await.map_err(surrealdb_core::rpc::types_error_from_anyhow)?;

		// Return success
		Ok(DbResult::Other(Value::None))
	}
}
