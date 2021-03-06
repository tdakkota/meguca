use super::buttons;
use super::state;
use yew::{html, Bridge, Bridged, Component, ComponentLink, Html, Properties};

// Central thread container
pub struct Thread {
	#[allow(unused)]
	state: Box<dyn Bridge<state::Agent>>,

	#[allow(unused)]
	link: ComponentLink<Self>,

	id: u64,
	pages: PageSet,
}

pub enum Message {
	ThreadChange,
	NOP,
}

// Pages to display in a thread
#[derive(Clone)]
pub enum PageSet {
	// Display OP + last 5 posts
	Last5Posts,

	// Display OP + selected pages.
	// If page set is smaller than 3, insert zeroes.
	Pages([u32; 3]),
}

impl Default for PageSet {
	fn default() -> Self {
		Self::Last5Posts
	}
}

#[derive(Clone, Properties)]
pub struct Props {
	pub id: u64,
	pub pages: PageSet,
}

impl Component for Thread {
	type Message = Message;
	type Properties = Props;

	fn create(props: Self::Properties, link: ComponentLink<Self>) -> Self {
		let mut s = state::Agent::bridge(link.callback(|u| match u {
			state::Subscription::ThreadChange(_) => Message::ThreadChange,
			_ => Message::NOP,
		}));
		s.send(state::Request::Subscribe(
			state::Subscription::ThreadChange(props.id),
		));
		Self {
			id: props.id,
			pages: props.pages,
			state: s,
			link,
		}
	}

	fn update(&mut self, msg: Self::Message) -> bool {
		match msg {
			Message::ThreadChange => true,
			Message::NOP => false,
		}
	}

	fn view(&self) -> Html {
		// TODO: Filter hidden posts

		let posts: Vec<u64> = match self.pages {
			PageSet::Last5Posts => {
				let mut v = Vec::with_capacity(5);
				let page_count =
					state::get().page_counts.get(&self.id).unwrap_or(&1);
				self.read_page_posts(&mut v, page_count - 1);
				if v.len() < 5 && page_count > &1 {
					self.read_page_posts(&mut v, page_count - 2);
				}
				v.sort_unstable();
				if v.len() > 5 {
					v[v.len() - 5..].iter().copied().collect()
				} else {
					v
				}
			}
			PageSet::Pages(pages) => {
				let mut v = Vec::with_capacity(300);
				for p in pages.iter() {
					self.read_page_posts(&mut v, *p);
				}
				v.sort_unstable();
				v
			}
		};

		html! {
			<section class="thread-container">
				<super::post::Post id=self.id />
				{
					for posts.into_iter().map(|id| {
						html! {
							<super::post::Post id={id} />
						}
					})
				}
				<buttons::AsideButton
					text="reply"
					on_click=self.link.callback(|_| Message::NOP)
				/>
			</section>
		}
	}
}

impl Thread {
	// Read the post IDs of a page, excluding the OP, into dst
	fn read_page_posts(&self, dst: &mut Vec<u64>, page: u32) {
		if let Some(posts) =
			state::get().posts_by_thread_page.get(&(self.id, page))
		{
			dst.extend(posts.iter().filter(|id| **id != self.id));
		}
	}
}
