use crate::err::{Error, Result};
use surrealdb_bridge::{NamespaceDatabase, Nullable};
use uuid::Uuid;
use wasm_bindgen::JsValue;
use web_sys::js_sys::{Object, Reflect, Uint8Array};

pub fn get_uuid(v: Uint8Array) -> Result<Uuid> {
	Uuid::from_slice(&v.to_vec()).map_err(Error::from)
}

pub fn ret_uuid(v: Uuid) -> Uint8Array {
	Uint8Array::from(v.as_bytes().as_slice())
}

pub fn get_opt_uuid(v: Option<Uint8Array>) -> Result<Option<Uuid>> {
	v.map(get_uuid).transpose()
}

pub fn get_ns_db(v: JsValue) -> Result<NamespaceDatabase> {
	let obj = Object::from(v);

	// Get namespace property
	let namespace_js = Reflect::get(&obj, &JsValue::from_str("namespace"))
		.map_err(|e| Error::from(format!("Failed to get namespace: {:?}", e)))?;
	let namespace = if namespace_js.is_undefined() {
		Nullable::None
	} else if namespace_js.is_null() {
		Nullable::Null
	} else {
		namespace_js
			.as_string()
			.map(Nullable::Some)
			.ok_or_else(|| Error::from("namespace must be a string, null, or undefined"))?
	};

	// Get database property
	let database_js = Reflect::get(&obj, &JsValue::from_str("database"))
		.map_err(|e| Error::from(format!("Failed to get database: {:?}", e)))?;
	let database = if database_js.is_undefined() {
		Nullable::None
	} else if database_js.is_null() {
		Nullable::Null
	} else {
		database_js
			.as_string()
			.map(Nullable::Some)
			.ok_or_else(|| Error::from("database must be a string, null, or undefined"))?
	};

	Ok(NamespaceDatabase {
		namespace,
		database,
	})
}
