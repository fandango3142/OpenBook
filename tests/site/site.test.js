const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const site = path.resolve(__dirname, '../../site');
const readPage = (name) => fs.readFileSync(path.join(site, name), 'utf8');

test('README is a detailed release-style landing page for the product site', () => {
  const readme = fs.readFileSync(path.resolve(__dirname, '../../README.md'), 'utf8');
  assert.match(readme, /<img[^>]+src="openbook-mark\.svg"[^>]+alt="OpenBook logo"/i);
  assert.match(readme, /\[Disposable Sheet configuration\]\(docs\/configuration\/sheets\.md\)/);
  assert.match(readme, /\[M1 smoke-test checklist\]\(docs\/testing\/milestone-1-smoke-test\.md\)/);
  assert.match(readme, /https:\/\/github\.com\/fandango3142\/OpenBook\/issues\/new/);
  assert.match(readme, /https:\/\/fandango3142\.github\.io\/OpenBook\/site\//);
  for (const section of ['Release overview', 'What’s included', 'Setup and test status', 'Run the checks', 'Known limitations', 'License and attribution']) {
    assert.match(readme, new RegExp(`## ${section}`));
  }
  assert.match(readme, /verified non-technical production setup/i);
  assert.match(readme, /Google quotas, availability, terms, and any charges/i);
  assert.doesNotMatch(readme, /public product site|GitHub Pages workflow|publishes only `site\//i);
  assert.doesNotMatch(readme, /official release|production-ready|guaranteed free/i);
});

test('landing page has a separate path that preserves the booking page at the root', () => {
  const readme = fs.readFileSync(path.resolve(__dirname, '../../README.md'), 'utf8');
  const bookingPage = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
  const home = readPage('index.html');
  assert.match(readme, /https:\/\/fandango3142\.github\.io\/OpenBook\/site\//);
  assert.match(bookingPage, /<title>Book a time · OpenBook<\/title>/);
  assert.match(home, /<title>OpenBook — Make room for your work\.<\/title>/);
  assert.ok(fs.existsSync(path.join(site, 'setup.html')));
});

test('homepage presents current OpenBook information and required links', () => {
  const home = readPage('index.html');
  const headings = [...home.matchAll(/<h1\b[^>]*>/gi)];
  assert.equal(headings.length, 1, 'homepage should have one clear H1');
  assert.match(home, /MIT License/i);
  assert.match(home, /Google.{0,80}(quota|usage|terms)/is);
  assert.match(home, /github\.com\/fandango3142\/OpenBook/i);
  assert.match(home, /issues are public|public issue/i);
  assert.match(home, /href="https:\/\/github.com\/fandango3142\/OpenBook\/blob\/master\/LICENSE"/);
  assert.match(home, /href="https:\/\/github.com\/fandango3142\/OpenBook\/issues\/new"/);
  assert.match(home, /quotas, availability, terms, and any charges/i);
  assert.match(home, /account and region/i);
  assert.match(home, /outside OpenBook.{0,20}control/i);
  assert.match(home, /confirmed immediately/i);
  assert.match(home, /email confirmation.{0,100}management link/is);
  assert.match(home, /cancellation and reschedule requests.{0,80}operator/is);
  assert.match(home, /illustrative examples/i);
  assert.doesNotMatch(home, /<blockquote|testimonials?|coming soon|upcoming|\bOTP\b|payments?|reminders?|\b\d+\s*\/\s*month/i);

  for (const example of ['coaching', 'tutoring', 'personal care', 'wellness', 'home services', 'classes']) {
    assert.match(home.toLowerCase(), new RegExp(example));
  }
});

test('homepage brand assets are accessible and responsive', () => {
  const home = readPage('index.html');
  const css = fs.readFileSync(path.join(site, 'assets/site.css'), 'utf8');
  const mark = fs.readFileSync(path.join(site, 'assets/openbook-mark.svg'), 'utf8');
  assert.match(home, /name="viewport"/);
  assert.match(home, /href="assets\/site.css"/);
  assert.doesNotMatch(home, /script\.google\.com\/macros\/s\/|apps_script_url|<form\b|<script(?![^>]*\bsrc=["']assets\/carousels\.js["'])[^>]*>|\bfetch\s*\(/i);
  assert.doesNotMatch(css, /@import|fonts\.googleapis\.com|googletagmanager|analytics/i);
  assert.match(mark, /<title[^>]*>OpenBook/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /@media/);
});

test('public pages use alternating color bands and motion-safe parallax', () => {
  const home = readPage('index.html');
  const setup = readPage('setup.html');
  const css = fs.readFileSync(path.join(site, 'assets/site.css'), 'utf8');

  assert.match(home, /<header class="site-header band-light"/);
  assert.match(home, /<section class="hero band-dark"/);
  assert.match(home, /<section class="section band-light"[^>]*id="how-it-works"/);
  assert.match(home, /<section class="data-section band-dark"/);
  assert.match(home, /<section class="section band-light"[^>]*id="examples"/);
  assert.match(home, /<section class="setup-callout band-dark"/);
  assert.match(setup, /<section class="setup-intro band-dark"/);
  assert.match(setup, /<section class="setup-steps-band band-light"/);
  assert.match(setup, /<section class="setup-behavior band-dark"/);
  assert.match(css, /\.band-dark\s*\{[^}]*background:\s*var\(--forest\)/s);
  assert.match(css, /\.band-light\s*\{[^}]*background:\s*#fff/s);
  assert.match(css, /\.booking-illustration p\s*\{\s*color:\s*var\(--muted\);/);
  assert.match(css, /\.booking-illustration strong\s*\{\s*color:\s*var\(--ink\);/);
  assert.match(css, /\.setup-warning p\s*\{[^}]*color:\s*var\(--muted\);/s);
  assert.match(css, /@supports\s*\(animation-timeline:\s*view\(\)\)/);
  assert.match(css, /animation-timeline:\s*view\(\)/);
  assert.match(css, /prefers-reduced-motion:\s*reduce[\s\S]*?animation:\s*none/);
});

test('homepage booking flow uses numbered cards, arrow controls, dots, and an autoplay pause control', () => {
  const home = readPage('index.html');
  const script = fs.readFileSync(path.join(site, 'assets/carousels.js'), 'utf8');
  assert.match(home, /<script[^>]+src="assets\/carousels\.js"[^>]+defer/);
  assert.match(home, /data-carousel="how-it-works"[^>]*data-autoplay/);
  assert.match(home, /aria-roledescription="carousel"/);
  assert.match(home, /class="flow-card"/);
  assert.match(home, /data-dots/);
  assert.match(home, /aria-label="Previous step"/);
  assert.match(home, /aria-label="Next step"/);
  assert.match(home, /aria-label="Pause automatic slide show"/);
  assert.equal([...home.matchAll(/data-slide="how-it-works"/g)].length, 3);
  assert.match(script, /prefers-reduced-motion/);
  assert.match(script, /document\.hidden/);
  assert.match(script, /Pause automatic slide show/);
  assert.match(script, /data-dots/);
  assert.match(script, /aria-current/);
});

test('examples are a manually controlled photo carousel with arrows and labeled position dots', () => {
  const home = readPage('index.html');
  const credits = fs.readFileSync(path.join(site, 'assets/ASSET-CREDITS.md'), 'utf8');
  const photoSlides = [...home.matchAll(/data-slide="examples"[\s\S]*?<img[^>]+src="assets\/photos\/([^\"]+)"/g)];
  assert.match(home, /data-carousel="examples"/);
  assert.match(home, /aria-label="Previous example"/);
  assert.match(home, /aria-label="Next example"/);
  assert.match(home, /data-dots/);
  assert.doesNotMatch(home, />Previous<|>Next<|data-counter/);
  assert.doesNotMatch(home, /Photos by Pexels contributors/);
  assert.equal(photoSlides.length, 6);
  assert.match(credits, /Pexels/i);
  assert.match(credits, /4342495/);
  for (const [, image] of photoSlides) {
    assert.ok(fs.existsSync(path.join(site, 'assets/photos', image)), `local photo should exist: ${image}`);
  }
});

test('setup guide offers competency-specific explanations in a step carousel', () => {
  const setup = readPage('setup.html');
  const script = fs.readFileSync(path.join(site, 'assets/carousels.js'), 'utf8');
  assert.match(setup, /data-setup-wizard/);
  assert.match(setup, /data-level="technical"/);
  assert.match(setup, /data-level-choice="plain"/);
  assert.match(setup, /data-level-copy="technical"/);
  assert.match(setup, /data-level-copy="plain"/);
  assert.match(setup, /How comfortable are you with technical setup\?/);
  assert.match(setup, /aria-pressed="true"/);
  assert.match(setup, /data-step="1"/);
  assert.match(setup, /aria-label="Setup progress"/);
  assert.match(script, /data-setup-wizard/);
  assert.match(script, /aria-current/);
  assert.match(script, /root\.scrollIntoView\(\{ behavior: reducedMotion\?\.matches \? 'auto' : 'smooth', block: 'start' \}\)/);
  assert.ok(
    script.indexOf("levelField.hidden = false;") < script.indexOf("if (slides.length < 2 || !controls) return;"),
    'setup level choices should initialize even when carousel controls are unavailable'
  );
});

test('service pictograms and external-link icon are local and properly identified', () => {
  const home = readPage('index.html');
  const setup = readPage('setup.html');
  const css = fs.readFileSync(path.join(site, 'assets/site.css'), 'utf8');
  const iconLicense = fs.readFileSync(path.join(site, 'assets/ICON-LICENSE.txt'), 'utf8');
  assert.match(home, /assets\/service-spreadsheet\.svg/);
  assert.match(home, /assets\/service-calendar\.svg/);
  assert.match(home, /assets\/service-email\.svg/);
  assert.match(home, /aria-label="Google services used by OpenBook"/);
  assert.doesNotMatch(home, /↗|▦/);
  assert.doesNotMatch(setup, /↗/);
  assert.match(home, /assets\/external-link\.svg/);
  assert.match(css, /\.band-dark \.button \.external-icon\s*\{[^}]*filter:\s*none/s);
  assert.match(css, /\.band-dark \.button \.external-icon\s*\{[^}]*width:\s*1\.1rem[^}]*height:\s*1\.1rem/s);
  assert.match(iconLicense, /Lucide/);
  assert.match(iconLicense, /ISC\s+License/);
  assert.match(iconLicense, /https:\/\/github\.com\/lucide-icons\/lucide/);
});

test('custom-build links open the provided email while setup help stays on GitHub Issues', () => {
  const home = readPage('index.html');
  const setup = readPage('setup.html');
  for (const page of [home, setup]) {
    assert.match(page, /<a[^>]*href="mailto:ryandsouza4@gmail\.com"[^>]*>Request a custom build/i);
  }
  assert.match(home, /href="https:\/\/github\.com\/fandango3142\/OpenBook\/issues\/new"[^>]*>Get setup help/i);
  assert.match(setup, /href="https:\/\/github\.com\/fandango3142\/OpenBook\/issues\/new"[^>]*>Ask on GitHub Issues/i);
});

test('homepage keeps carousel controls on-card with compact dots and illustrated booking steps', () => {
  const home = readPage('index.html');
  const css = fs.readFileSync(path.join(site, 'assets/site.css'), 'utf8');
  for (const illustration of ['booking-choice.svg', 'booking-record.svg', 'booking-email.svg']) {
    assert.match(home, new RegExp(`assets/${illustration}`));
    assert.ok(fs.existsSync(path.join(site, 'assets', illustration)), `${illustration} should exist`);
  }
  assert.match(css, /\.carousel-controls\s*\{[^}]*position:\s*absolute/s);
  assert.match(css, /\.carousel-dots\s*\{[^}]*backdrop-filter:\s*blur/s);
  assert.match(css, /\.carousel-dot\s*span\s*\{[^}]*width:\s*6px/s);
  assert.match(css, /\.carousel-arrow\s*\{[^}]*background:\s*rgba\(/s);
});

test('setup upsell is differentiated on dark and hero offers custom help', () => {
  const home = readPage('index.html');
  const css = fs.readFileSync(path.join(site, 'assets/site.css'), 'utf8');
  assert.match(home, /<section class="setup-callout band-dark"/);
  assert.match(home, /href="mailto:ryandsouza4@gmail\.com"[^>]*>Need custom help/i);
  assert.match(css, /\.help-note\s*\{[^}]*background:\s*var\(--soft\)/s);
  assert.match(css, /\.help-note\s*\{[^}]*border-radius:/s);
  assert.match(css, /\.band-dark \.button\s*\{[^}]*background:\s*#fff[^}]*color:\s*var\(--forest\)/s);
  assert.match(css, /\.band-dark \.help-note h3, \.band-dark \.help-note a\s*\{[^}]*color:\s*var\(--ink\)/s);
  assert.match(css, /\.band-dark \.help-note p\s*\{[^}]*color:\s*var\(--muted\)/s);
  assert.match(css, /\.band-dark \.help-note a\s*\{[^}]*color:\s*var\(--ink\)/s);
});

test('MIT license is named only once, in the homepage foundations row', () => {
  const home = readPage('index.html');
  const setup = readPage('setup.html');
  assert.equal([...`${home}\n${setup}`.matchAll(/MIT License/gi)].length, 1);
  assert.match(home, /principles-inner[\s\S]*?MIT License/);
  assert.match(home, /principles-inner[\s\S]*?href="https:\/\/github\.com\/fandango3142\/OpenBook\/blob\/master\/LICENSE"/);
});

test('hero mockup stays self-contained and omits redundant explanatory lines', () => {
  const home = readPage('index.html');
  const css = fs.readFileSync(path.join(site, 'assets/site.css'), 'utf8');
  assert.doesNotMatch(home, /class="hero-note"|<figcaption>Illustration only/);
  assert.match(css, /\.sample-window\s*\{[^}]*width:\s*100%/s);
  assert.match(css, /\.sample-times\s*>\s*span\s*\{[^}]*min-width:\s*0/s);
});

test('booking-flow slide places copy left of its visual and gives the card depth', () => {
  const home = readPage('index.html');
  const css = fs.readFileSync(path.join(site, 'assets/site.css'), 'utf8');
  assert.match(home, /<div class="flow-copy">[\s\S]*?<\/div><img class="flow-visual"/);
  assert.match(css, /\.flow-card\s*\{[^}]*display:\s*grid/s);
  assert.match(css, /\.flow-card\s*\{[^}]*grid-template-columns:\s*1fr 45%/s);
  assert.match(css, /\.flow-card\s*\{[^}]*align-items:\s*start/s);
  assert.match(css, /\.flow-card\s*\{[^}]*box-shadow:\s*0 18px 48px/s);
  assert.match(css, /\.carousel\[data-carousel="how-it-works"\]\s*\{[^}]*max-width:\s*64rem/s);
  assert.match(css, /\.flow-card\s*\{[^}]*padding:\s*2rem 3\.5rem/s);
  assert.match(css, /\.flow-visual\s*\{[^}]*height:\s*18rem/s);
  assert.match(css, /@media \(max-width:\s*44rem\)[\s\S]*?\.carousel-controls \.carousel-arrow\s*\{[^}]*width:\s*34px/s);
});

test('example carousel uses a wider card with larger imagery and tighter insets', () => {
  const css = fs.readFileSync(path.join(site, 'assets/site.css'), 'utf8');
  assert.match(css, /\.example-carousel\.carousel-enhanced\s*\{[^}]*max-width:\s*64rem/s);
  assert.match(css, /\.example-carousel\.carousel-enhanced \.example-grid article\s*\{[^}]*padding:\s*1rem 3\.5rem 3\.5rem/s);
  assert.match(css, /\.example-carousel\.carousel-enhanced \.example-grid article > img\s*\{[^}]*height:\s*18rem/s);
});

test('hero extends a subtle rangoli motif across its full dark background', () => {
  const css = fs.readFileSync(path.join(site, 'assets/site.css'), 'utf8');
  assert.match(css, /\.hero\.band-dark::before\s*\{[^}]*background-image:\s*url\("rangoli-pattern\.svg"\)/s);
  assert.match(css, /\.hero\.band-dark::before\s*\{[^}]*inset:\s*0/s);
  assert.match(css, /\.hero-inner\s*\{[^}]*z-index:\s*1/s);
});

test('Google services caveat and creator credit sit in the page-bottom footer', () => {
  const home = readPage('index.html');
  assert.doesNotMatch(home, /<details class="service-note/);
  assert.match(home, /<div class="wrap site-footer-legal">[\s\S]*?Google quotas, availability, terms, and any charges/);
  assert.match(home, /© 2026 <a href="https:\/\/ryanbuilds\.in">Ryan D'Souza<\/a>\. All rights reserved\./);
  assert.ok(home.indexOf('Google quotas, availability') > home.indexOf('<footer class="site-footer'));
});

test('hero mockup uses a subtle local rangoli-inspired decorative pattern', () => {
  const css = fs.readFileSync(path.join(site, 'assets/site.css'), 'utf8');
  const pattern = fs.readFileSync(path.join(site, 'assets/rangoli-pattern.svg'), 'utf8');
  assert.match(css, /\.booking-illustration\s*\{[^}]*background-image:\s*url\("rangoli-pattern\.svg"\)/s);
  assert.match(pattern, /<svg[^>]+viewBox="0 0 160 160"/);
  assert.match(pattern, /opacity="0\.2"/);
});

test('flow illustrations fill a distinct framed panel instead of blending into the card', () => {
  const css = fs.readFileSync(path.join(site, 'assets/site.css'), 'utf8');
  for (const illustration of ['booking-choice.svg', 'booking-record.svg', 'booking-email.svg']) {
    const svg = fs.readFileSync(path.join(site, 'assets', illustration), 'utf8');
    assert.match(svg, /viewBox="0 0 320 240"/);
  }
  assert.match(css, /\.flow-visual\s*\{[^}]*height:\s*18rem/s);
  assert.match(css, /\.flow-visual\s*\{[^}]*padding:\s*\.4rem/s);
  assert.match(css, /\.flow-visual\s*\{[^}]*background:\s*var\(--soft\)/s);
  assert.match(css, /\.flow-visual\s*\{[^}]*border:\s*1px solid var\(--line\)/s);
});

test('setup guide describes only the present test/developer procedure', () => {
  const setup = readPage('setup.html');
  assert.match(setup, /test only/i);
  assert.match(setup, /configuration\/sheets\.md/i);
  assert.match(setup, /milestone-1-smoke-test\.md/i);
  assert.match(setup, /review.{0,60}(source|permissions)|permissions.{0,60}review/is);
  assert.match(setup, /sheet.{0,80}(read|access|booking data)/is);
  assert.match(setup, /no verified non-technical production installation path/i);
  assert.match(setup, /href="https:\/\/github.com\/fandango3142\/OpenBook\/blob\/master\/docs\/configuration\/sheets\.md"/);
  assert.match(setup, /href="https:\/\/github.com\/fandango3142\/OpenBook\/blob\/master\/docs\/testing\/milestone-1-smoke-test\.md"/);
  assert.match(setup, /disposable Sheet and two dedicated test Calendars/i);
  assert.match(setup, /GitHub Pages product-site URL.{0,100}customer booking URL/is);
  assert.match(setup, /actual Google permission prompt/i);
  assert.match(setup, /CONFIRMED/);
  assert.match(setup, /cancellation and reschedule requests.{0,80}operator review/is);
  assert.doesNotMatch(setup, /script\.google\.com|AKfycb[A-Za-z0-9_-]+|bypass.{0,60}warning/i);
  assert.equal([...setup.matchAll(/<li class="setup-step"/g)].length, 4);
  const visibleSetupCopy = setup.replace(/https:\/\/github\.com\/[^" ]+/g, '');
  assert.doesNotMatch(visibleSetupCopy, /\bM1\b|milestone-1/i);
  for (const visual of ['prepare', 'script', 'configure', 'verify']) {
    const diagram = fs.readFileSync(path.join(site, `assets/setup-${visual}.svg`), 'utf8');
    assert.match(diagram, /<title[^>]*>[^<]*Avery Studio/);
    assert.match(diagram, /<desc[ >]/);
  }
  assert.doesNotMatch(setup, /<section class="service-note/);
  assert.match(setup, /<section class="setup-help band-light"[\s\S]*?class="help-note setup-help-card"/);
  assert.match(setup, /<a class="button" href="mailto:ryandsouza4@gmail\.com">Request a custom build/);
  assert.match(setup, /<a class="text-link" href="https:\/\/github\.com\/fandango3142\/OpenBook\/issues\/new">Ask on GitHub Issues/);
  assert.match(setup, /© 2026 <a href="https:\/\/ryanbuilds\.in">Ryan D'Souza<\/a>\. All rights reserved\./);
  assert.match(setup, /<ol class="setup-steps">[\s\S]*?<\/ol>\s*<div class="carousel-controls setup-wizard-footer" hidden>/);
  const css = fs.readFileSync(path.join(site, 'assets/site.css'), 'utf8');
  assert.match(css, /\.setup-carousel \.setup-wizard-footer\s*\{[^}]*position:\s*relative[^}]*display:\s*grid/s);
  assert.match(css, /\.setup-wizard-nav\s*\{[^}]*white-space:\s*nowrap/s);
  assert.match(css, /\.setup-help-card\s*\{[^}]*padding:\s*2rem/s);
  assert.match(css, /\.help-note\s*\{[^}]*background:\s*var\(--soft\)/s);
});

test('setup wizard shows an Avery Studio visual walkthrough with breadcrumb navigation below each step', () => {
  const setup = readPage('setup.html');
  const script = fs.readFileSync(path.join(site, 'assets/carousels.js'), 'utf8');
  const css = fs.readFileSync(path.join(site, 'assets/site.css'), 'utf8');
  const steps = ['prepare', 'script', 'configure', 'verify'];

  assert.match(setup, /Avery Studio/);
  assert.match(setup, /45-minute consultations/);
  assert.match(setup, /<li class="setup-step"[^>]*data-step="1"[\s\S]*?<img class="setup-step-visual"[^>]*src="assets\/setup-prepare\.svg"/);
  assert.match(setup, /src="assets\/setup-script\.svg"/);
  assert.match(setup, /src="assets\/setup-configure\.svg"/);
  assert.match(setup, /src="assets\/setup-verify\.svg"/);
  assert.doesNotMatch(setup, /<figure class="setup-visual">[\s\S]*?<figcaption>/);
  assert.match(setup, /<ol class="setup-steps">[\s\S]*?<\/ol>\s*<div class="carousel-controls setup-wizard-footer" hidden>[\s\S]*?data-previous[\s\S]*?data-step-list[\s\S]*?data-next/);
  assert.match(setup, /data-step-link="1"[\s\S]*?Prepare assets/);
  assert.match(setup, /data-step-link="2"[\s\S]*?Connect script/);
  assert.match(setup, /data-step-link="3"[\s\S]*?Set up booking/);
  assert.match(setup, /data-step-link="4"[\s\S]*?Try a booking/);
  assert.doesNotMatch(setup, /data-counter|Setup step progress|1 of 4/);
  assert.match(script, /data-step-link/);
  assert.match(script, /aria-current.*step/);
  assert.match(script, /details\.open = false/);
  assert.match(script, /link\.classList\.toggle\('is-complete'/);
  assert.match(script, /Math\.max\(0, Math\.min\(index, slides\.length - 1\)\)/);
  assert.match(script, /previousButton\.disabled = current === 0/);
  assert.match(script, /nextButton\.disabled = current === slides\.length - 1/);
  assert.match(css, /\.setup-wizard-footer\s*\{[^}]*display:\s*grid/s);
  assert.match(css, /\.setup-stage\s*\{[^}]*grid-template-columns:\s*minmax\(0, \.82fr\) minmax\(0, 1\.18fr\)/s);
  assert.match(css, /\.setup-step \.step-number\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*justify-content:\s*center[^}]*margin:\s*0[^}]*padding:\s*0/s);
  assert.match(css, /\.setup-step-list li \+ li::before\s*\{[^}]*z-index:\s*0/s);
  assert.match(css, /\.setup-step-list button span\s*\{[^}]*position:\s*relative[^}]*z-index:\s*1/s);
  assert.match(css, /\.setup-step-list button\s*\{[^}]*flex-direction:\s*column/s);
  assert.match(css, /\.setup-wizard-nav\s*\{[^}]*height:\s*2\.15rem[^}]*align-self:\s*start/s);

  for (const name of steps) {
    const svg = fs.readFileSync(path.join(site, `assets/setup-${name}.svg`), 'utf8');
    assert.match(svg, /<svg/);
    assert.match(svg, /Avery Studio/);
    assert.match(svg, /Illustrative/);
  }
});

test('site navigation is reciprocal between homepage and setup guide', () => {
  const home = readPage('index.html');
  const setup = readPage('setup.html');
  assert.match(home, /href=["']setup\.html(?:#[^"']*)?["']/i);
  assert.match(setup, /href=["']index\.html(?:#[^"']*)?["']/i);
});

test('public pages stay static, local, and disconnected from the disposable backend', () => {
  const home = readPage('index.html');
  const setup = readPage('setup.html');
  for (const html of [home, setup]) {
    assert.doesNotMatch(html, /script\.google\.com\/macros\/s\//i);
  assert.doesNotMatch(html, /apps_script_url|<form\b|<script(?![^>]*\bsrc=["']assets\/carousels\.js["'])[^>]*>|\bfetch\s*\(/i);
    assert.match(html, /<script src="assets\/carousels\.js" defer><\/script>/);
    assert.doesNotMatch(html, /upcoming|coming soon/i);
  }

  const css = fs.readFileSync(path.join(site, 'assets/site.css'), 'utf8');
  assert.doesNotMatch(css, /@import|fonts\.googleapis\.com|googletagmanager|analytics/i);

  const localSvgReferences = [...`${home}\n${setup}`.matchAll(/(?:src|href)=["']([^"']+\.svg)(?:[?#][^"']*)?["']/gi)];
  assert.ok(localSvgReferences.length > 0, 'site should reference at least one local SVG asset');
  for (const [, reference] of localSvgReferences) {
    assert.ok(!/^(?:[a-z]+:)?\/\//i.test(reference), `SVG reference should be local: ${reference}`);
    assert.ok(fs.existsSync(path.join(site, reference)), `referenced SVG should exist: ${reference}`);
  }
});
