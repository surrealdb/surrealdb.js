use std::sync::Arc;
use std::time::Duration;

mod options;
mod types;

use arc_swap::ArcSwap;
use cbor::Cbor;
use futures::StreamExt;
use options::Options;
use serde_wasm_bindgen::from_value;
use surrealdb::dbs::Notification;
use surrealdb::dbs::Session;
use surrealdb::kvs::export::Config;
use surrealdb::kvs::Datastore;
use surrealdb::rpc::format::cbor;
use surrealdb::rpc::RpcProtocolV1;
use surrealdb::rpc::RpcProtocolV2;
use surrealdb::rpc::{Data, RpcContext};
use surrealdb::sql::{Object, Value};
use tokio::sync::Semaphore;
use types::TsConnectionOptions;
use uuid::Uuid;
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::JsValue;
use wasm_streams::readable::sys;
use wasm_streams::ReadableStream;
use web_sys::js_sys::Uint8Array;

pub use crate::err::Error;

#[wasm_bindgen]
pub struct SurrealWasmEngine(SurrealWasmConnection);

#[wasm_bindgen]
impl SurrealWasmEngine {
	pub async fn execute(&mut self, data: Uint8Array) -> Result<Uint8Array, Error> {
		let in_data = cbor::req(data.to_vec()).map_err(|e| e.to_string())?;
		let res = RpcContext::execute(&self.0, in_data.version, in_data.method, in_data.params)
			.await
			.map_err(|e| e.to_string())?;

		let value: Value = res.try_into()?;
		let out = cbor::res(value).map_err(|e| e.to_string())?;

		Ok(out.as_slice().into())
	}

	pub fn notifications(&self) -> Result<sys::ReadableStream, Error> {
		let stream = self.0.kvs.notifications().ok_or("Notifications not enabled")?;

		fn process_notification(notification: Notification) -> Result<JsValue, JsValue> {
			// Construct live message
			let mut message = Object::default();

			message.insert("id".to_string(), notification.id.into());
			message.insert("action".to_string(), notification.action.to_string().into());
			message.insert("record".to_string(), notification.record.into());
			message.insert("result".to_string(), notification.result);

			// Into CBOR value
			let cbor: Cbor = Value::Object(message)
				.try_into()
				.map_err(|_| JsValue::from_str("Failed to convert notification to CBOR"))?;

			let mut res = Vec::new();
			ciborium::into_writer(&cbor.0, &mut res).unwrap();
			let out_arr: Uint8Array = res.as_slice().into();

			Ok(out_arr.into())
		}

		let response = stream.map(process_notification);

		Ok(ReadableStream::from_stream(response).into_raw())
	}

	pub async fn connect(
		endpoint: String,
		opts: Option<TsConnectionOptions>,
	) -> Result<SurrealWasmEngine, Error> {
		let endpoint = match &endpoint {
			s if s.starts_with("mem:") => "memory",
			s => s,
		};

		let kvs = Datastore::new(endpoint).await?.with_notifications();
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

		let connection = SurrealWasmConnection {
			kvs: Arc::new(kvs),
			session: ArcSwap::new(Arc::new(session)),
			lock: Arc::new(Semaphore::new(1)),
		};

		Ok(SurrealWasmEngine(connection))
	}

	pub async fn export(&self, config: Option<Uint8Array>) -> Result<String, Error> {
		let (tx, rx) = channel::unbounded();

		match config {
			Some(config) => {
				let in_config = cbor::parse_value(config.to_vec()).map_err(|e| e.to_string())?;
				let config = Config::try_from(&in_config).map_err(|e| e.to_string())?;

				self.0.kvs.export_with_config(self.0.session().as_ref(), tx, config).await?.await?;
			}
			None => {
				self.0.kvs.export(self.0.session().as_ref(), tx).await?.await?;
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
		self.0.kvs.import(&input, self.0.session().as_ref()).await?;

		Ok(())
	}

	pub fn version() -> Result<String, Error> {
		Ok(env!("SURREALDB_VERSION").into())
	}
}

struct SurrealWasmConnection {
	pub kvs: Arc<Datastore>,
	pub lock: Arc<Semaphore>,
	pub session: ArcSwap<Session>,
}

impl RpcContext for SurrealWasmConnection {
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

impl RpcProtocolV1 for SurrealWasmConnection {}
impl RpcProtocolV2 for SurrealWasmConnection {}
