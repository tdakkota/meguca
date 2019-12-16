use super::state;
use wasm_bindgen::JsCast;
use web_sys;

// Generate functions for safely accessing global variable.
//
// $type must be public
#[macro_export]
macro_rules! gen_global {
	($type:ty, $default:expr) => {
		// Open global for writing
		#[allow(unused)]
		pub fn with<F, R>(mut cb: F) -> R
		where
			F: FnMut(&mut $type) -> R,
		{
			unsafe {
				static mut GLOBAL: Option<$type> = None;
				if GLOBAL.is_none() {
					GLOBAL = Some($default);
				}
				cb(unsafe { GLOBAL.as_mut().unwrap() })
			}
		}
	};
	($type:ty) => {
		super::gen_global!($type, Default::default());
	};
}

// Wrap and cache static Rust callback closure and pass it the module state
#[macro_export]
macro_rules! cache_cb {
	($type:ty, $fn:expr) => {
		unsafe {
			use wasm_bindgen::prelude::*;
			use wasm_bindgen::JsCast;

			static mut CACHED: Option<Closure<$type>> = None;
			if CACHED.is_none() {
				CACHED = Some(Closure::wrap(Box::from(&$fn)));
				}
			CACHED.as_ref().unwrap().as_ref().unchecked_ref()
			}
	};
}

// Get JS window global
pub fn window() -> web_sys::Window {
	web_sys::window().expect("window undefined")
}

// Get page document
pub fn document() -> web_sys::Document {
	window().document().expect("document undefined")
}

// Get page body
pub fn body() -> web_sys::HtmlElement {
	document().body().expect("body undefined")
}

// Add static passive DOM event listener
#[macro_export]
macro_rules! add_listener {
	($target:expr, $type:expr, $fn:expr) => {
		$target
			.add_event_listener_with_callback_and_add_event_listener_options(
				$type,
				cache_cb!(dyn Fn(web_sys::Event), |e| {
					super::state::with(|s| $fn(s, e))
				}),
				&{
					let mut opts = web_sys::AddEventListenerOptions::new();
					opts.passive(true);
					opts
				},
				)
			.unwrap();
	};
}
