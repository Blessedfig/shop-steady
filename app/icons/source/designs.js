// Icon designs for Downtown Stube. Each returns an SVG on a 512 canvas.
// safe=true shrinks the artwork to 80% (maskable safe zone) while the background stays full bleed.
const C = { pine: '#1B4332', pineDk: '#123025', mustard: '#F2C14E', brandy: '#A8461A', cream: '#FBF3E0', sage: '#F2F5F0' };
const FONT = "font-family:'Shrikhand'";

function wrap(bg, art, safe) {
  const g = safe ? `<g transform="translate(256 256) scale(0.8) translate(-256 -256)">${art}</g>` : art;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">${bg}${g}</svg>`;
}

const designs = {
  // A: big script S, the wordmark letter, with a brandy drop shadow and a menu-card frame
  monogram(safe) {
    const bg = `<rect width="512" height="512" fill="${C.pine}"/>`;
    const art = `
      <rect x="56" y="56" width="400" height="400" rx="72" fill="none" stroke="${C.mustard}" stroke-width="10"/>
      <rect x="78" y="78" width="356" height="356" rx="54" fill="none" stroke="${C.mustard}" stroke-width="3" opacity=".7"/>
      <text x="270" y="392" text-anchor="middle" font-size="330" style="${FONT}" fill="${C.brandy}">S</text>
      <text x="256" y="378" text-anchor="middle" font-size="330" style="${FONT}" fill="${C.mustard}">S</text>`;
    return wrap(bg, art, safe);
  },

  // B: a downtown shopfront with a striped supper-club awning and a lit window
  storefront(safe) {
    const bg = `<rect width="512" height="512" fill="${C.pine}"/>`;
    let stripes = '', scallops = '';
    for (let i = 0; i < 9; i++) {
      const x = 76 + i * 40, col = i % 2 ? C.mustard : C.brandy;
      stripes += `<rect x="${x}" y="168" width="40" height="62" fill="${col}"/>`;
      scallops += `<circle cx="${x + 20}" cy="230" r="20" fill="${col}"/>`;
    }
    const art = `
      <rect x="96" y="120" width="320" height="320" fill="${C.cream}"/>
      <rect x="86" y="108" width="340" height="30" rx="6" fill="${C.pineDk}"/>
      ${stripes}${scallops}
      <rect x="124" y="276" width="146" height="128" rx="6" fill="${C.mustard}"/>
      <rect x="124" y="276" width="146" height="128" rx="6" fill="none" stroke="${C.pineDk}" stroke-width="10"/>
      <rect x="192" y="276" width="10" height="128" fill="${C.pineDk}"/>
      <rect x="298" y="276" width="90" height="164" rx="6" fill="${C.brandy}"/>
      <circle cx="372" cy="364" r="8" fill="${C.mustard}"/>
      <rect x="72" y="436" width="368" height="14" rx="4" fill="${C.pineDk}"/>`;
    return wrap(bg, art, safe);
  },

  // C: the Stube itself, a gabled room at night with the lights on
  litWindow(safe) {
    const bg = `<rect width="512" height="512" fill="${C.pine}"/>`;
    const art = `
      <circle cx="388" cy="118" r="30" fill="${C.cream}" opacity=".9"/>
      <circle cx="402" cy="108" r="28" fill="${C.pine}"/>
      <rect x="318" y="118" width="40" height="80" fill="${C.pineDk}"/>
      <polygon points="256,96 444,244 444,436 68,436 68,244" fill="${C.brandy}"/>
      <polygon points="256,96 456,254 432,254 256,118 80,254 56,254" fill="${C.pineDk}"/>
      <rect x="168" y="232" width="176" height="164" rx="12" fill="${C.mustard}"/>
      <rect x="249" y="232" width="14" height="164" fill="${C.brandy}"/>
      <rect x="168" y="307" width="176" height="14" fill="${C.brandy}"/>
      <rect x="152" y="396" width="208" height="16" rx="4" fill="${C.pineDk}"/>`;
    return wrap(bg, art, safe);
  },

  // D: a round supper-club matchbook badge with DS initials
  badge(safe) {
    const bg = `<rect width="512" height="512" fill="${C.brandy}"/>`;
    const art = `
      <circle cx="256" cy="256" r="196" fill="${C.pine}"/>
      <circle cx="256" cy="256" r="196" fill="none" stroke="${C.mustard}" stroke-width="14"/>
      <circle cx="256" cy="256" r="168" fill="none" stroke="${C.mustard}" stroke-width="3" opacity=".7"/>
      <text x="256" y="318" text-anchor="middle" font-size="176" style="${FONT}" fill="${C.mustard}">DS</text>
      <rect x="176" y="350" width="160" height="8" rx="4" fill="${C.cream}" opacity=".85"/>`;
    return wrap(bg, art, safe);
  },
};

module.exports = { designs, C };
