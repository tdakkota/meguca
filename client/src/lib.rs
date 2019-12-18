mod connection;
mod fsm;
mod state;
mod util;

use wasm_bindgen::prelude::*;
use yew;

#[wasm_bindgen]
pub fn run_app() -> Result<(), JsValue> {
	console_error_panic_hook::set_once();

	// yew::start_app::<app::App>();

	state::with(|s| {
		connection::init(s);
	});

	Ok(())
}
