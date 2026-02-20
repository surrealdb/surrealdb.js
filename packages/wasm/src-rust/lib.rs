mod app;
mod err;

#[cfg(feature = "debug")]
mod debug {
	use wasm_bindgen::prelude::wasm_bindgen;

	#[wasm_bindgen(start)]
	fn init_panic_hook() {
		console_error_panic_hook::set_once();
	}
}
