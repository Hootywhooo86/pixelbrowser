// Phishing/malware warning page. Its links go to a made-up host that the
// main process intercepts (go back, or continue to the site once).
const q = new URLSearchParams(location.search)
const url = q.get('url') || ''
document.getElementById('host').textContent = q.get('host') || url
document.getElementById('go').href = 'https://warning.bitbrowser.invalid/continue?url=' + encodeURIComponent(url)
document.getElementById('back').focus()
