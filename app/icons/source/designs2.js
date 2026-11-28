const { designs: d1, C } = require('./designs.js');
const FONT = "font-family:'Shrikhand'";
const wrap = (bg, art, safe, defs='') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><defs>${defs}</defs>${bg}${safe ? `<g transform="translate(256 256) scale(0.8) translate(-256 -256)">${art}</g>` : art}</svg>`;
const nightBg = `<radialGradient id="bg" cx="50%" cy="38%" r="75%"><stop offset="0" stop-color="#24573F"/><stop offset="1" stop-color="#0E2219"/></radialGradient>`;
const BG = `<rect width="512" height="512" fill="url(#bg)"/>`;
const designs = {
  // E: lit marquee sign, like the one out front of a supper club
  marquee(safe) {
    const defs = nightBg + `<linearGradient id="bd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#C2582A"/><stop offset="1" stop-color="#8C3712"/></linearGradient>
      <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
    let bulbs = '';
    const x0 = 70, x1 = 442, y0 = 140, y1 = 346, n = 9, m = 5;
    for (let i = 0; i <= n; i++) { const x = x0 + (x1 - x0) * i / n; bulbs += `<circle cx="${x}" cy="${y0}" r="11"/><circle cx="${x}" cy="${y1}" r="11"/>`; }
    for (let j = 1; j < m; j++) { const y = y0 + (y1 - y0) * j / m; bulbs += `<circle cx="${x0}" cy="${y}" r="11"/><circle cx="${x1}" cy="${y}" r="11"/>`; }
    const art = `
      <rect x="230" y="346" width="52" height="110" fill="#0B1A13"/>
      <rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" rx="28" fill="url(#bd)" stroke="#6E2A0D" stroke-width="26"/>
      <g fill="${C.mustard}" filter="url(#glow)">${bulbs}</g>
      <text x="256" y="276" text-anchor="middle" font-size="96" style="${FONT}" fill="#5E230A">Stube</text>
      <text x="256" y="270" text-anchor="middle" font-size="96" style="${FONT}" fill="${C.cream}">Stube</text>`;
    return wrap(BG, art, safe, defs);
  },
  // F: a brass shop key with the S cut into its bow
  key(safe) {
    const defs = nightBg + `<linearGradient id="brass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFE08A"/><stop offset=".5" stop-color="${C.mustard}"/><stop offset="1" stop-color="#C28E1E"/></linearGradient>`;
    const art = `<g transform="translate(256 266) scale(.88) translate(-256 -256)"><g transform="rotate(-40 256 256)">
      <g transform="translate(10 14)" fill="#081510" opacity=".45"><circle cx="256" cy="150" r="104"/><rect x="236" y="230" width="40" height="230" rx="8"/></g>
      <circle cx="256" cy="150" r="104" fill="url(#brass)"/>
      <circle cx="256" cy="150" r="80" fill="none" stroke="#C28E1E" stroke-width="5"/>
      <text x="258" y="200" text-anchor="middle" font-size="150" style="${FONT}" fill="${C.pine}" transform="rotate(40 256 150)">S</text>
      <rect x="236" y="240" width="40" height="220" rx="8" fill="url(#brass)"/>
      <rect x="276" y="372" width="48" height="26" rx="4" fill="url(#brass)"/>
      <rect x="276" y="416" width="36" height="26" rx="4" fill="url(#brass)"/>
      <rect x="226" y="246" width="60" height="16" rx="6" fill="#C28E1E"/>
    </g></g>`;
    return wrap(BG, art, safe, defs);
  },
  // G: the shop door's hanging Open sign
  openSign(safe) {
    const defs = `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#235640"/><stop offset="1" stop-color="#153527"/></linearGradient>
      <linearGradient id="bd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#BE5526"/><stop offset="1" stop-color="#933A13"/></linearGradient>`;
    const art = `
      <path d="M256 92 L118 214 M256 92 L394 214" stroke="${C.cream}" stroke-width="7" fill="none" stroke-linecap="round"/>
      <rect x="84" y="214" width="344" height="196" rx="26" fill="#0B1F16" opacity=".45" transform="translate(8 14)"/>
      <rect x="84" y="200" width="344" height="196" rx="26" fill="url(#bd)"/>
      <rect x="102" y="218" width="308" height="160" rx="16" fill="none" stroke="${C.mustard}" stroke-width="6"/>
      <circle cx="118" cy="214" r="9" fill="${C.mustard}"/><circle cx="394" cy="214" r="9" fill="${C.mustard}"/>
      <text x="256" y="330" text-anchor="middle" font-size="100" style="${FONT}" fill="${C.cream}">Open</text>
      <circle cx="256" cy="92" r="14" fill="${C.mustard}"/><circle cx="252" cy="88" r="5" fill="#FFE9A8"/>`;
    return wrap(`<rect width="512" height="512" fill="url(#bg)"/>`, art, safe, defs);
  },
  // H: a Wisconsin brandy Old Fashioned, the supper club classic
  oldFashioned(safe) {
    const defs = nightBg + `<linearGradient id="drink" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#D9772F"/><stop offset="1" stop-color="#8E3512"/></linearGradient>
      <clipPath id="glass"><path d="M150 186 H362 L344 420 Q342 436 326 436 H186 Q170 436 168 420 Z"/></clipPath>`;
    const art = `
      <ellipse cx="256" cy="446" rx="130" ry="16" fill="#08150F" opacity=".5"/>
      <g clip-path="url(#glass)">
        <rect x="140" y="186" width="232" height="260" fill="#FFFFFF" opacity=".10"/>
        <rect x="140" y="262" width="232" height="190" fill="url(#drink)"/>
        <rect x="186" y="236" width="74" height="74" rx="10" fill="#FFFFFF" opacity=".32" transform="rotate(-12 223 273)"/>
        <rect x="256" y="252" width="66" height="66" rx="10" fill="#FFFFFF" opacity=".26" transform="rotate(14 289 285)"/>
        <rect x="176" y="186" width="14" height="250" fill="#FFFFFF" opacity=".25"/>
      </g>
      <path d="M150 186 H362 L344 420 Q342 436 326 436 H186 Q170 436 168 420 Z" fill="none" stroke="${C.cream}" stroke-width="8" stroke-linejoin="round"/>
      <g transform="rotate(18 340 186)">
        <circle cx="340" cy="186" r="62" fill="#E8862E"/><circle cx="340" cy="186" r="50" fill="${C.mustard}"/>
        <g stroke="#E8862E" stroke-width="5">${[0,45,90,135].map(a=>`<line x1="${340-50*Math.cos(a*Math.PI/180)}" y1="${186-50*Math.sin(a*Math.PI/180)}" x2="${340+50*Math.cos(a*Math.PI/180)}" y2="${186+50*Math.sin(a*Math.PI/180)}"/>`).join('')}</g>
        <circle cx="340" cy="186" r="8" fill="#E8862E"/>
      </g>
      <path d="M196 196 Q186 130 228 96" stroke="#5B7A3A" stroke-width="7" fill="none" stroke-linecap="round"/>
      <circle cx="196" cy="206" r="30" fill="#9E1F1F"/><circle cx="186" cy="196" r="9" fill="#FFFFFF" opacity=".45"/>`;
    return wrap(BG, art, safe, defs);
  },
};
module.exports = { designs, C };
