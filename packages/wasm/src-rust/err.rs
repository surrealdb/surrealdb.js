use wasm_bindgen::JsValue;

pub type Result<T, E = Error> = core::result::Result<T, E>;

#[derive(Debug)]
pub struct Error(JsValue);

impl From<Error> for JsValue {
	fn from(Error(value): Error) -> Self {
		value
	}
}

impl From<anyhow::Error> for Error {
	fn from(v: anyhow::Error) -> Self {
		Self(JsValue::from(v.to_string()))
	}
}

impl From<serde_wasm_bindgen::Error> for Error {
	fn from(v: serde_wasm_bindgen::Error) -> Self {
		Self(JsValue::from(v.to_string()))
	}
}

impl From<&str> for Error {
	fn from(v: &str) -> Self {
		Self(JsValue::from(v))
	}
}

impl From<String> for Error {
	fn from(v: String) -> Self {
		Self(JsValue::from(v))
	}
}

impl From<uuid::Error> for Error {
	fn from(v: uuid::Error) -> Self {
		Self(JsValue::from(v.to_string()))
	}
}

impl From<surrealdb_core::rpc::RpcError> for Error {
	fn from(v: surrealdb_core::rpc::RpcError) -> Self {
		Self(JsValue::from(v.to_string()))
	}
}
