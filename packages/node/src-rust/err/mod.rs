pub fn err_map(err: impl std::error::Error) -> napi::Error {
	napi::Error::from_reason(err.to_string())
}
