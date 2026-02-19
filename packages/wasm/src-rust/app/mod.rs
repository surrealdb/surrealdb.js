use std::future::Future;
use std::sync::Arc;
use std::sync::RwLock as StdRwLock;
use std::time::Duration;

mod options;
mod types;

macro_rules! wasm_trace {
	($($arg:tt)*) => {
		#[cfg(feature = "debug")]
		web_sys::console::log_1(&format!($($arg)*).into());
	};
}

pub use crate::err::Error;
use dashmap::DashMap;
use futures::channel::oneshot;
use futures::StreamExt;
use options::Options;
use serde_wasm_bindgen::from_value;
use surrealdb_core::dbs::Session;
use surrealdb_core::kvs::export::Config;
use surrealdb_core::kvs::{Datastore, LockType, Transaction, TransactionType};
use surrealdb_core::rpc::format::cbor;
use surrealdb_core::rpc::{DbResult, Request, RpcProtocol};
use surrealdb_types::Value;
use surrealdb_types::{Array, HashMap, Notification};
use tokio::sync::RwLock;
use uuid::Uuid;
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::JsValue;
use wasm_bindgen_futures::spawn_local;
use wasm_streams::readable::sys;
use wasm_streams::ReadableStream;
use web_sys::js_sys::Uint8Array;

#[wasm_bindgen]
pub struct SurrealWasmEngine(SurrealWasmConnection);

#[wasm_bindgen]
impl SurrealWasmEngine {
	/// Takes `&self` so the wasm_bindgen trampoline does not require exclusive access.
	/// Using `&mut self` here causes "Unreachable code" panics when the engine is still
	/// considered borrowed (e.g. by the notification stream or async completion), before
	/// the function body runs.
	pub async fn execute(&self, data: Uint8Array) -> Result<Uint8Array, Error> {
		let data = data.to_vec();
		let obj = cbor::decode(data.as_slice()).map_err(|e| e.to_string())?.into_object()?;
		let req = Request::from_object(obj)?;
		let res = RpcProtocol::execute(
			&self.0,
			req.txn.map(Into::into),
			req.session_id.map(Into::into),
			req.method,
			req.params,
		)
		.await;

		match res {
			Ok(result) => {
				let value = Value::from_t(result);
				let out = cbor::encode(value).map_err(|e| e.to_string())?;
				Ok(out.as_slice().into())
			}
			Err(rpc_err) => {
				let mut envelope = surrealdb_types::Object::default();
				envelope.insert("error".to_string(), Value::from_t(rpc_err));
				let out = cbor::encode(Value::Object(envelope)).map_err(|e| e.to_string())?;
				Ok(out.as_slice().into())
			}
		}
	}

	pub fn notifications(&self) -> Result<sys::ReadableStream, Error> {
		let stream = self.0.kvs.notifications().ok_or("Notifications not enabled")?;

		fn process_notification(notification: Notification) -> Result<JsValue, JsValue> {
			// Into CBOR value
			let value = Value::from_t(notification);

			let res = cbor::encode(value).map_err(|e| e.to_string())?;
			let out_arr: Uint8Array = res.as_slice().into();

			Ok(out_arr.into())
		}

		let response = stream.map(process_notification);

		Ok(ReadableStream::from_stream(response).into_raw())
	}

	pub async fn connect(endpoint: String, opts: JsValue) -> Result<SurrealWasmEngine, Error> {
		let endpoint = match &endpoint {
			s if s.starts_with("mem:") => "memory",
			s => s,
		};

		// Avoid from_value(undefined): that path can trigger a wasm_bindgen closure that panics
		// (Unreachable) when used with panic=abort. Handle undefined/null explicitly.
		let opts: Option<Options> = if opts.is_undefined() || opts.is_null() {
			None
		} else {
			Some(from_value::<Options>(opts)?)
		};
		let defaults = opts.as_ref().and_then(|o| o.defaults.clone()).unwrap_or_default();

		wasm_trace!("[wasm] creating datastore at {endpoint}");
		let kvs = Datastore::new(endpoint).await?;
		wasm_trace!("[wasm] enabling notifications");
		let kvs = kvs.with_notifications();
		wasm_trace!("[wasm] configuring datastore");
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

		wasm_trace!("[wasm] checking version");
		let (_, is_new) = kvs.check_version().await?;
		wasm_trace!("[wasm] version checked, is_new={is_new}");

		if is_new {
			if let Some(defaults) = defaults.get_defaults() {
				wasm_trace!("[wasm] initialising defaults");
				kvs.initialise_defaults(&defaults.0, &defaults.1).await?;
				wasm_trace!("[wasm] defaults initialised");
			}
		}

		wasm_trace!("[wasm] creating connection");
		let connection = SurrealWasmConnection {
			kvs: Arc::new(kvs),
			live_queries: Arc::new(StdRwLock::new(HashMap::new())),
			transactions: Default::default(),
			sessions: Default::default(),
		};

		// Store the default session
		let session = Session::default().with_rt(true);
		connection.set_session(None, Arc::new(RwLock::new(session)));

		Ok(SurrealWasmEngine(connection))
	}

	pub async fn export(&self, config: Option<Uint8Array>) -> Result<String, Error> {
		let (tx, rx) = channel::unbounded();

		let Some(session) = self.0.sessions.get(&None) else {
			return Err(Error::from("session not found"));
		};

		let session = session.read().await;

		match config {
			Some(config) => {
				let config = config.to_vec();
				let config = cbor::decode(config.as_slice())?;
				let config = config.into_t::<Config>()?;
				self.0.kvs.export_with_config(&session, tx, config).await?.await?;
			}
			None => {
				self.0.kvs.export(&session, tx).await?.await?;
			}
		};

		let mut buffer = Vec::new();
		while let Ok(item) = rx.try_recv() {
			buffer.push(item);
		}

		let result = String::from_utf8(buffer.concat().into()).map_err(|e| e.to_string())?;

		Ok(result)
	}

	pub async fn import(&self, input: String) -> Result<(), Error> {
		let Some(session) = self.0.sessions.get(&None) else {
			return Err(Error::from("session not found"));
		};

		let session = session.read().await;

		self.0.kvs.import(&input, &session).await?;

		Ok(())
	}

	pub fn version() -> Result<String, Error> {
		Ok(env!("SURREALDB_VERSION").into())
	}
}

struct SurrealWasmConnection {
	pub kvs: Arc<Datastore>,
	pub live_queries: Arc<StdRwLock<HashMap<Uuid, Option<Uuid>>>>,
	pub transactions: DashMap<Uuid, Arc<Transaction>>,
	pub sessions: HashMap<Option<Uuid>, Arc<RwLock<Session>>>,
}

impl SurrealWasmConnection {
	/// Runs a sync retain on live_queries, then deletes collected query ids on kvs.
	/// Wrapped in AssertSend so the future satisfies the trait’s Send bound (WASM is single-threaded).
	fn cleanup_live_queries_async<F>(&self, retain: F) -> impl Future<Output = ()> + Send
	where
		F: FnOnce(&mut HashMap<Uuid, Option<Uuid>>, &mut Vec<Uuid>) + Send,
	{
		let kvs = Arc::clone(&self.kvs);
		let live_queries = Arc::clone(&self.live_queries);
		let mut gc = Vec::new();
		{
			let mut guard = live_queries.write().unwrap();
			retain(&mut guard, &mut gc);
		}
		let (tx, rx) = oneshot::channel();
		spawn_local(async move {
			let _ = kvs.delete_queries(gc).await;
			let _ = tx.send(());
		});
		async move {
			let _ = rx.await;
		}
	}
}

impl RpcProtocol for SurrealWasmConnection {
	fn kvs(&self) -> &Datastore {
		&self.kvs
	}

	fn version_data(&self) -> DbResult {
		DbResult::Other(Value::String(format!("surrealdb-{}", env!("SURREALDB_VERSION"))))
	}

	/// A pointer to all active sessions
	fn session_map(&self) -> &HashMap<Option<Uuid>, Arc<RwLock<Session>>> {
		&self.sessions
	}

	const LQ_SUPPORT: bool = true;

	/// Handles the cleanup of live queries
	fn cleanup_lqs(&self, session_id: Option<&Uuid>) -> impl Future<Output = ()> + Send {
		let session_id = session_id.copied();
		self.cleanup_live_queries_async(move |map, gc| {
			map.retain(|key, value| {
				if value.as_ref() == session_id.as_ref() {
					gc.push(*key);
					false
				} else {
					true
				}
			});
		})
	}

	/// Handles the cleanup of all live queries
	fn cleanup_all_lqs(&self) -> impl Future<Output = ()> + Send {
		self.cleanup_live_queries_async(|map, gc| {
			map.retain(|key, _| {
				gc.push(*key);
				false
			});
		})
	}

	fn handle_live(
		&self,
		lqid: &Uuid,
		session_id: Option<Uuid>,
	) -> impl Future<Output = ()> + Send {
		let live_queries = Arc::clone(&self.live_queries);
		let lqid = *lqid;
		async move {
			live_queries.write().unwrap().insert(lqid, session_id);
		}
	}

	fn handle_kill(&self, lqid: &Uuid) -> impl Future<Output = ()> + Send {
		let live_queries = Arc::clone(&self.live_queries);
		let lqid = *lqid;
		async move {
			live_queries.write().unwrap().remove(&lqid);
		}
	}

	// ------------------------------
	// Transactions
	// ------------------------------

	/// Retrieves a transaction by ID
	async fn get_tx(
		&self,
		id: Uuid,
	) -> Result<Arc<surrealdb_core::kvs::Transaction>, surrealdb_types::Error> {
		self.transactions
			.get(&id)
			.map(|tx| tx.clone())
			.ok_or_else(|| surrealdb_core::rpc::invalid_params("Transaction not found"))
	}

	/// Stores a transaction
	async fn set_tx(
		&self,
		id: Uuid,
		tx: Arc<surrealdb_core::kvs::Transaction>,
	) -> Result<(), surrealdb_types::Error> {
		self.transactions.insert(id, tx);
		Ok(())
	}

	// ------------------------------
	// Methods for transactions
	// ------------------------------

	/// Begin a new transaction
	async fn begin(
		&self,
		_txn: Option<Uuid>,
		_session_id: Option<Uuid>,
	) -> Result<DbResult, surrealdb_types::Error> {
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
	) -> Result<DbResult, surrealdb_types::Error> {
		// Extract the transaction ID from params
		let mut params_vec = params.into_vec();
		let Some(Value::Uuid(txn_id)) = params_vec.pop() else {
			return Err(surrealdb_core::rpc::invalid_params("Expected transaction UUID"));
		};

		let txn_id = txn_id.into_inner();

		// Retrieve and remove the transaction from the map
		let Some((_, tx)) = self.transactions.remove(&txn_id) else {
			return Err(surrealdb_core::rpc::invalid_params("Transaction not found"));
		};

		// Commit the transaction
		tx.commit().await.map_err(surrealdb_core::rpc::types_error_from_anyhow)?;

		// Return success
		Ok(DbResult::Other(Value::None))
	}

	/// Cancel a transaction
	async fn cancel(
		&self,
		_txn: Option<Uuid>,
		_session_id: Option<Uuid>,
		params: Array,
	) -> Result<DbResult, surrealdb_types::Error> {
		// Extract the transaction ID from params
		let mut params_vec = params.into_vec();
		let Some(Value::Uuid(txn_id)) = params_vec.pop() else {
			return Err(surrealdb_core::rpc::invalid_params("Expected transaction UUID"));
		};

		let txn_id = txn_id.into_inner();

		// Retrieve and remove the transaction from the map
		let Some((_, tx)) = self.transactions.remove(&txn_id) else {
			return Err(surrealdb_core::rpc::invalid_params("Transaction not found"));
		};

		// Cancel the transaction
		tx.cancel().await.map_err(surrealdb_core::rpc::types_error_from_anyhow)?;

		// Return success
		Ok(DbResult::Other(Value::None))
	}
}
