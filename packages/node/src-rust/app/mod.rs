mod options;

use std::sync::Arc;
use std::time::Duration;

use crate::err::err_map;
use arc_swap::ArcSwap;
use napi::bindgen_prelude::*;
use napi::tokio::sync::RwLock;
use napi::tokio::sync::Semaphore;
use napi_derive::napi;

use options::Options;
use serde_json::from_value;
use serde_json::Value as JsValue;
use surrealdb::dbs::Session;
use surrealdb::kvs::export::Config;
use surrealdb::kvs::Datastore;
use surrealdb::rpc::format::cbor;
use surrealdb::rpc::RpcProtocolV1;
use surrealdb::rpc::RpcProtocolV2;

use surrealdb::rpc::{Data, RpcContext};
use surrealdb::sql::Value;
use uuid::Uuid;

#[napi]
pub struct SurrealNodeEngine(RwLock<Option<SurrealNodeConnection>>);

#[napi]
impl SurrealNodeEngine {
	#[napi]
	pub async fn execute(&self, data: Uint8Array) -> std::result::Result<Uint8Array, Error> {
		let lock = self.0.read().await;
		let engine = lock.as_ref().unwrap();
		let in_data = cbor::req(data.to_vec()).map_err(err_map)?;
		let res = RpcContext::execute(engine, in_data.version, in_data.method, in_data.params)
			.await
			.map_err(err_map)?;

		let value: Value = res.try_into().map_err(err_map)?;
		let out = cbor::res(value).map_err(err_map)?;

		Ok(out.as_slice().into())
	}

	// pub fn notifications(&self) -> std::result::Result<sys::ReadableStream, Error> {
	//     let stream = self.0.kvs.notifications().ok_or("Notifications not enabled")?;
	//
	//
	//     let response = stream.map(|notification| {
	//         let json = json!({
	// 			"id": notification.id,
	// 			"action": notification.action.to_string(),
	// 			"result": notification.result.into_json(),
	// 		});
	//         to_value(&json).map_err(Into::into)
	//     });
	//     Ok(ReadableStream::from_stream(response).into_raw())
	// }

	#[napi]
	pub async fn connect(
		endpoint: String,
		#[napi(ts_arg_type = "ConnectionOptions")] opts: Option<JsValue>,
	) -> std::result::Result<SurrealNodeEngine, Error> {
		let endpoint = match &endpoint {
			s if s.starts_with("mem:") => "memory",
			s => s,
		};

		let kvs = Datastore::new(endpoint).await.map_err(err_map)?.with_notifications();
		let kvs = match from_value::<Option<Options>>(JsValue::from(opts))? {
			None => kvs,
			Some(opts) => kvs
				.with_capabilities(
					opts.capabilities.map_or(Ok(Default::default()), |a| a.try_into())?,
				)
				.with_transaction_timeout(
					opts.transaction_timeout.map(|qt| Duration::from_secs(qt as u64)),
				)
				.with_query_timeout(opts.query_timeout.map(|qt| Duration::from_secs(qt as u64)))
				.with_strict_mode(opts.strict.map_or(Default::default(), |s| s)),
		};

		let session = Session::default().with_rt(true);

		let connection = SurrealNodeConnection {
			kvs: Arc::new(kvs),
			session: ArcSwap::new(Arc::new(session)),
			lock: Arc::new(Semaphore::new(1)),
		};

		Ok(SurrealNodeEngine(RwLock::new(Some(connection))))
	}

	#[napi]
	pub async fn export(&self, config: Option<Uint8Array>) -> std::result::Result<String, Error> {
		let lock = self.0.read().await;
		let engine = lock.as_ref().unwrap();
		let (tx, rx) = channel::unbounded();

		match config {
			Some(config) => {
				let in_config = cbor::parse_value(config.to_vec()).map_err(err_map)?;
				let config = Config::try_from(&in_config).map_err(err_map)?;

				engine
					.kvs
					.export_with_config(engine.session().as_ref(), tx, config)
					.await
					.map_err(err_map)?
					.await
					.map_err(err_map)?;
			}
			None => {
				engine
					.kvs
					.export(engine.session().as_ref(), tx)
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

		engine.kvs.import(&input, engine.session().as_ref()).await.map_err(err_map)?;

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
	pub lock: Arc<Semaphore>,
	pub session: ArcSwap<Session>,
}

impl RpcContext for SurrealNodeConnection {
	fn kvs(&self) -> &Datastore {
		&self.kvs
	}

	fn lock(&self) -> Arc<Semaphore> {
		self.lock.clone()
	}

	fn session(&self) -> Arc<Session> {
		self.session.load_full()
	}

	fn set_session(&self, session: Arc<Session>) {
		self.session.store(session);
	}

	fn version_data(&self) -> Data {
		Value::Strand(format!("surrealdb-{}", env!("SURREALDB_VERSION")).into()).into()
	}

	const LQ_SUPPORT: bool = true;

	fn handle_live(&self, _lqid: &Uuid) -> impl std::future::Future<Output = ()> + Send {
		async { () }
	}

	fn handle_kill(&self, _lqid: &Uuid) -> impl std::future::Future<Output = ()> + Send {
		async { () }
	}
}

impl RpcProtocolV1 for SurrealNodeConnection {}
impl RpcProtocolV2 for SurrealNodeConnection {}
