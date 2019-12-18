mod connection;
mod fsm;
mod state;
mod util;
use yew::{html, Component, ComponentLink, Html, ShouldRender};

pub fn main() {
	console_error_panic_hook::set_once();

	state::with(|s| {
		connection::init(s);
	});
}
