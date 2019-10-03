import { makeAttrs, makeFrag, escape, on, fetchJSON } from "../util"

type OEmbedDoc = {
	title?: string
	html?: string
	error?: string
}

type InvidiousUrl = {
	url: string
}

type InvidiousRes = {
	title: string
	videoThumbnails: [InvidiousUrl]
	formatStreams: [InvidiousUrl]
}

// Currently existing downloaded youtube video info
const youtubeCache = new Map<string, OEmbedDoc>();

// Currently existing downloaded bitchute video title
const bitchuteCache = new Map<string, string>()

// Types of different embeds by provider
enum provider { YouTube, SoundCloud, Vimeo, Coub, BitChute, Invidious }

// Matching patterns and their respective providers
const patterns: [provider, RegExp][] = [
	[
		provider.YouTube,
		/https?:\/\/(?:[^\.]+\.)?(?:youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/watch\?v=)[a-zA-Z0-9_-]+/,
	],
	[
		provider.SoundCloud,
		/https?:\/\/soundcloud.com\/.*/,
	],
	[
		provider.Vimeo,
		/https?:\/\/(?:www\.)?vimeo\.com\/.+/,
	],
	[
		provider.Coub,
		/https?:\/\/(?:www\.)?coub\.com\/view\/.+/,
	],
	[
		provider.BitChute,
		/https?:\/\/(?:[^\.]+\.)?(?:bitchute\.com\/embed\/|bitchute\.com\/video\/)[a-zA-Z0-9_-]+/,
	],
	[
		provider.Invidious,
		/https?:\/\/(?:www\.)?invidio\.us\/watch(.*&|\?)v=.+/,
	],
]

// Map of providers to formatter functions
const formatters: { [key: number]: (s: string) => string } = {}

// Map of providers to information fetcher functions
const fetchers: { [key: number]: (el: Element) => Promise<any> } = {}

for (let p of [
	"YouTube",
	"SoundCloud",
	"Vimeo",
	"Coub",
	"BitChute",
	"Invidious",
]) {
	const id = (provider as any)[p] as number
	formatters[id] = formatProvider(id)
	switch (id) {
		case provider.YouTube:
			fetchers[id] = fetchYouTube
			break
		case provider.BitChute:
			fetchers[id] = fetchBitChute
			break
		case provider.Invidious:
			fetchers[id] = fetchInvidious
			break
		default:
			fetchers[id] = fetchNoEmbed(id)
	}
}

// formatter for the noembed.com meta-provider, YouTube or BitChute
function formatProvider(type: provider): (s: string) => string {
	return (href: string) => {
		const attrs = {
			rel: "noreferrer",
			href: escape(href),
			class: "embed",
			target: "_blank",
			"data-type": type.toString(),
		}
		return `<em><a ${makeAttrs(attrs)}>[${provider[type]}] ???</a></em>`
	}
}

// fetcher for the BitChute provider
async function fetchBitChute(el: Element): Promise<void> {
	const ref = el.getAttribute("href"),
		id = strip(ref.split("embed/").pop().split("video/"))

	if (!bitchuteCache.has(id)) {
		const res = await fetch(`/api/bitchute-title/${id}`),
			title = await res.text()

		switch (res.status) {
			case 200:
				if (!title) {
					el.textContent = format("Error: Title does not exist", provider.BitChute)
					el.classList.add("errored")
					return
				}

				bitchuteCache.set(id, title)
				break
			case 500:
				el.textContent = format("Error 500: BitChute is not available", provider.BitChute)
				el.classList.add("errored")
				return
			default:
				const errmsg = `Error ${res.status}: ${res.statusText}`
				el.textContent = format(errmsg, provider.BitChute)
				el.classList.add("errored")
				console.error(errmsg)
				return
		}
	}

	el.textContent = format(bitchuteCache.get(id), provider.BitChute)
	el.setAttribute("data-html", encodeURIComponent(
		`<iframe width="480" height="270" src="https://bitchute.com/embed/${id}" `
		+ `referrerpolicy="no-referrer" sandbox="allow-scripts" allowfullscreen></iframe>`
	))
}

async function fetchYouTube(el: Element): Promise<void> {
	const href = el.getAttribute("href");
	const cached = youtubeCache.get(href);
	if (cached) {
		setNoembedData(el, provider.YouTube, cached);
		return;
	}

	const data = await fetchNoEmbed(provider.YouTube)(el);
	if (data) {
		youtubeCache.set(href, data);
	}
}

function strip(s: string[]): string {
	return s.pop().split('&').shift().split('#').shift().split('?').shift()
}

// fetcher for the invidio.us provider
async function fetchInvidious(el: Element): Promise<void> {
	const url = new URL(el.getAttribute("href")),
		id = url.searchParams.get("v"),
		[data, err] = await fetchJSON<InvidiousRes>(
			`https://invidio.us/api/v1/videos/${id}?fields=title,formatStreams,videoThumbnails`)

	if (err) {
		el.textContent = format(err, provider.Invidious)
		el.classList.add("erred")
		console.error(err)
		return
	}

	el.textContent = format(data.title, provider.Invidious)
	const thumb = data.videoThumbnails[0].url,
		video = data.formatStreams[0].url,
		title = data.title
	el.textContent = format(title, provider.Invidious)
	const t = url.searchParams.get("t"),
		start = url.searchParams.get("start"),
		tparam = t ? `#t=${t}` : start ? `#t=${start}` : ''
	el.setAttribute("data-html", encodeURIComponent(
		`<video width="480" height="270" poster="${thumb}" `
		+ (url.searchParams.get("loop") === "1" ? "loop " : '') +
		`controls><source src="${video}${tparam}" />`
	))
}

// fetcher for the noembed.com meta-provider
function fetchNoEmbed(
	type: provider,
): (el: Element) => Promise<OEmbedDoc | null> {
	return async (el: Element) => {
		const url = "https://noembed.com/embed?url=" + el.getAttribute("href"),
			[data, err] = await fetchJSON<OEmbedDoc>(url)

		if (err) {
			el.textContent = format(err, type)
			el.classList.add("erred")
			console.error(err)
			return
		}

		if (data.error) {
			el.textContent = format(data.error, type)
			el.classList.add("erred")
			return
		}

		setNoembedData(el, type, data);
		return data;
	}
}

function setNoembedData(el: Element, type: provider, data: OEmbedDoc) {
	el.textContent = format(data.title, type);
	el.setAttribute("data-html", encodeURIComponent(data.html.trim()));
}

function format(s: string, type: provider): string {
	return `[${provider[type]}] ${s}`
}

// Match and parse URL against embeddable formats. If matched, returns the
// generated HTML embed string, otherwise returns empty string.
export function parseEmbeds(s: string): string {
	for (let [type, patt] of patterns) {
		if (patt.test(s)) {
			return formatters[type](s)
		}
	}
	return ""
}

// Fetch and render any metadata int the embed on mouseover
function fetchMeta(e: MouseEvent) {
	const el = e.target as Element
	if (el.hasAttribute("data-title-requested")
		|| el.classList.contains("expanded")
	) {
		return
	}
	el.setAttribute("data-title-requested", "true")
	execFetcher(el)
}

function execFetcher(el: Element): Promise<void> {
	return fetchers[parseInt(el.getAttribute("data-type"))](el)
}

// Toggle the expansion of an embed
async function toggleExpansion(e: MouseEvent) {
	const el = e.target as Element

	// Don't trigger, when user is trying to open in a new tab or fetch has
	// erred
	if (e.which !== 1 || e.ctrlKey || el.classList.contains("erred")) {
		return
	}
	e.preventDefault()

	if (el.classList.contains("expanded")) {
		el.classList.remove("expanded")
		const iframe = el.lastChild
		if (iframe) {
			iframe.remove()
		}
		return
	}

	// The embed was clicked before a mouseover (ex: touch screen)
	if (!el.hasAttribute("data-html")) {
		await execFetcher(el)
	}

	const html = decodeURIComponent(el.getAttribute("data-html")),
		frag = makeFrag(html)

	// Restrict embedded iframe access to the page. Improves privacy.
	for (let el of frag.querySelectorAll("iframe")) {
		el.setAttribute("referrerpolicy", "no-referrer")
		el.setAttribute(
			"sandbox",
			"allow-scripts allow-same-origin allow-popups allow-modals",
		)
	}

	el.append(frag)
	el.classList.add("expanded")
}

on(document, "mouseover", fetchMeta, {
	passive: true,
	selector: "a.embed",
})
on(document, "click", toggleExpansion, {
	selector: "a.embed",
})

