// Pixel themes: the main process injects the chosen theme's CSS variables
// into every local page (shell, sidebar, settings) with insertCSS, so pages
// only need tokens.css. This file is kept so pages can include it safely;
// it marks the page as themeable for styles that want to know.
document.documentElement.dataset.themed = '1'
