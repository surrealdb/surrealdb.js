use futures::StreamExt;
use serde_wasm_bindgen::from_value;
use surrealdb_bridge::opts::Options;
use surrealdb_bridge::Bridge;
use surrealdb_core::rpc::format::cbor;
use surrealdb_types::{Notification, SurrealValue, Variables};
use wasm_bindgen::prelude::*;
use wasm_streams::readable::sys;
use wasm_streams::ReadableStream;
use web_sys::js_sys::Uint8Array;

pub mod err;
use err::*;

pub mod utils;
use utils::*;

#[wasm_bindgen]
pub struct SurrealWasmEngine(Bridge);

#[wasm_bindgen]
impl SurrealWasmEngine {
	pub async fn connect(endpoint: String, opts: Option<JsValue>) -> Result<SurrealWasmEngine> {
		let opts = from_value::<Option<Options>>(JsValue::from(opts))?;
		Bridge::connect(endpoint, opts).await.map(SurrealWasmEngine).map_err(Error::from)
	}

	pub async fn yuse(&self, session_id: Option<Uint8Array>, ns_db: JsValue) -> Result<()> {
		self.0.yuse(get_opt_uuid(session_id)?, get_ns_db(ns_db)?).await.map_err(Error::from)
	}

	pub fn version(&self) -> String {
		self.0.version()
	}

	pub fn sessions(&self) -> Vec<Uint8Array> {
		self.0.sessions().iter().map(|s| ret_uuid(s.clone())).collect()
	}

	pub async fn signup(
		&self,
		session_id: Option<Uint8Array>,
		params: Uint8Array,
	) -> Result<Uint8Array> {
		let vars = Variables::from(cbor::decode(&params.to_vec())?.into_object()?);
		let out = self.0.signup(get_opt_uuid(session_id)?, vars).await?;
		Ok(cbor::encode(out)?.as_slice().into())
	}

	pub async fn signin(
		&self,
		session_id: Option<Uint8Array>,
		params: Uint8Array,
	) -> Result<Uint8Array> {
		let vars = Variables::from(cbor::decode(&params.to_vec())?.into_object()?);
		let out = self.0.signin(get_opt_uuid(session_id)?, vars).await?;
		Ok(cbor::encode(out)?.as_slice().into())
	}

	pub async fn authenticate(&self, session_id: Option<Uint8Array>, token: String) -> Result<()> {
		self.0.authenticate(get_opt_uuid(session_id)?, token).await.map_err(Error::from)
	}

	pub async fn set(
		&self,
		session_id: Option<Uint8Array>,
		name: String,
		value: Uint8Array,
	) -> Result<()> {
		let value = cbor::decode(&value.to_vec())?;
		self.0.set(get_opt_uuid(session_id)?, name, value).await.map_err(Error::from)
	}

	pub async fn unset(&self, session_id: Option<Uint8Array>, name: String) -> Result<()> {
		self.0.unset(get_opt_uuid(session_id)?, name).await.map_err(Error::from)
	}

	pub async fn refresh(
		&self,
		session_id: Option<Uint8Array>,
		tokens: Uint8Array,
	) -> Result<Uint8Array> {
		let tokens = cbor::decode(&tokens.to_vec())?;
		let out = self.0.refresh(get_opt_uuid(session_id)?, tokens).await?;
		Ok(cbor::encode(out)?.as_slice().into())
	}

	pub async fn revoke(&self, tokens: Uint8Array) -> Result<()> {
		let tokens = cbor::decode(&tokens.to_vec())?;
		self.0.revoke(tokens).await.map_err(Error::from)
	}

	pub async fn invalidate(&self, session_id: Option<Uint8Array>) -> Result<()> {
		self.0.invalidate(get_opt_uuid(session_id)?).await.map_err(Error::from)
	}

	pub async fn reset(&self, session_id: Option<Uint8Array>) -> Result<()> {
		self.0.reset(get_opt_uuid(session_id)?).await.map_err(Error::from)
	}

	pub async fn begin(&self) -> Result<Uint8Array> {
		let txn = self.0.begin().await?;
		Ok(ret_uuid(txn))
	}

	pub async fn commit(&self, txn: Uint8Array) -> Result<()> {
		let txn = get_uuid(txn)?;
		self.0.commit(txn).await.map_err(Error::from)
	}

	pub async fn cancel(&self, txn: Uint8Array) -> Result<()> {
		let txn = get_uuid(txn)?;
		self.0.cancel(txn).await.map_err(Error::from)
	}

	pub async fn import(&self, session_id: Option<Uint8Array>, sql: String) -> Result<()> {
		self.0.import(get_opt_uuid(session_id)?, sql).await.map_err(Error::from)
	}

	pub async fn export(
		&self,
		session_id: Option<Uint8Array>,
		config: Uint8Array,
	) -> Result<String> {
		let config = cbor::decode(&config.to_vec())?;
		let out = self.0.export(get_opt_uuid(session_id)?, config).await?;
		Ok(out)
	}

	pub async fn query(
		&self,
		session_id: Option<Uint8Array>,
		txn: Option<Uint8Array>,
		query: String,
		vars: Uint8Array,
	) -> Result<Uint8Array> {
		let vars = Variables::from(cbor::decode(&vars.to_vec())?.into_object()?);
		let res = self.0.query(get_opt_uuid(session_id)?, get_opt_uuid(txn)?, query, vars).await?;
		let out = surrealdb_types::Value::from_vec(res);
		Ok(cbor::encode(out)?.as_slice().into())
	}

	pub fn notifications(&self) -> Result<sys::ReadableStream> {
		fn process_notification(notification: Notification) -> Result<JsValue, JsValue> {
			let res = cbor::encode(SurrealValue::into_value(notification))
				.map_err(|_| JsValue::from_str("Failed to convert notification to CBOR"))?;

			Ok(JsValue::from(Uint8Array::from(res.as_slice())))
		}

		Ok(ReadableStream::from_stream(self.0.notifications()?.map(process_notification))
			.into_raw())
	}
}
