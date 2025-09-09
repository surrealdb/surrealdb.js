use wasm_bindgen::JsValue;

#[derive(Debug)]
pub struct Error(JsValue);

impl From<Error> for JsValue {
	fn from(Error(value): Error) -> Self {
		value
	}
}

impl From<surrealdb::Error> for Error {
	fn from(v: surrealdb::Error) -> Self {
		Self(JsValue::from(v.to_string()))
	}
}

impl From<surrealdb::err::Error> for Error {
	fn from(v: surrealdb::err::Error) -> Self {
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
