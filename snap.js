// Line up text with the notebook paper. The paper has a solid line every 96px
// with a dotted line halfway between. Two kinds of text:
//
//   data-snap          regular text: every line is centered in a half-space,
//                      between a dotted line and a solid line (lines are 48px apart).
//   data-snap="span"   big text (headlines, the stamp, the #numbers): centered
//                      between two solid lines, crossing the dotted line.
//
// [data-snap-root] is a container whose blocks get lined up. In-flow blocks are
// spaced with margin-top (so they never overlap), then the whole container is
// nudged so its first block lands on the paper. Positioned blocks, and ones marked
// data-snap-free, are nudged in place with translate instead.
// [data-snap-ratio] is for drawings (like an SVG): where their middle is, as a
// fraction of their height.
(function () {
  var ROW = 96;      // solid line to solid line
  var HALF = 48;     // solid line to dotted line
  var CAP = 0.7;     // capital letter height as a fraction of the font size
  var MIN_GAP = 8;   // never pull a block closer than this to what's above it

  function mod(a, n) { return ((a % n) + n) % n; }
  function isBlock(el) {
    return /^(block|flex|grid|list-item)$/.test(getComputedStyle(el).display);
  }
  function edgeBlock(el, last) {
    var child = last ? el.lastElementChild : el.firstElementChild;
    while (child && isBlock(child)) {
      el = child;
      child = last ? el.lastElementChild : el.firstElementChild;
    }
    return el;
  }
  function baselineAt(el, atEnd) {
    var mark = document.createElement('span');
    mark.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
    if (atEnd) el.appendChild(mark); else el.insertBefore(mark, el.firstChild);
    var y = mark.getBoundingClientRect().top;
    mark.parentNode.removeChild(mark);
    return y;
  }
  function capMiddle(el, atEnd) {
    return baselineAt(el, atEnd) - parseFloat(getComputedStyle(el).fontSize) * CAP / 2;
  }

  // Where the block's middle is now, and where it should land: any point that is
  // `phase` past a multiple of `period` (page coordinates).
  function measure(el) {
    var big = el.getAttribute('data-snap') === 'span';
    var ratio = parseFloat(el.getAttribute('data-snap-ratio'));
    if (ratio) {
      var box = el.getBoundingClientRect();
      return { center: box.top + box.height * ratio, period: ROW, phase: HALF };
    }
    var first = edgeBlock(el, false);
    var last = edgeBlock(el, true);
    if (!big) {
      // Regular text: line up the first line; the rest follow one half-space apart.
      if (first === el && el.style.lineHeight !== HALF + 'px') el.style.lineHeight = HALF + 'px';
      return { center: capMiddle(first, false), period: HALF, phase: HALF / 2 };
    }
    // Big text: center the whole block (both ends, so a slanted line counts its
    // middle) in as many solid-line gaps as it needs.
    var top = baselineAt(first, false) - parseFloat(getComputedStyle(first).fontSize) * CAP;
    var bottom = baselineAt(last, true);
    var gaps = Math.max(1, Math.ceil((bottom - top + 16) / ROW));
    return { center: (top + bottom) / 2, period: ROW, phase: gaps % 2 ? HALF : 0 };
  }

  function prevInFlow(el) {
    var prev = el.previousElementSibling;
    while (prev && (prev.tagName === 'BR' || /absolute|fixed/.test(getComputedStyle(prev).position))) {
      prev = prev.previousElementSibling;
    }
    return prev;
  }
  // What to move: the block itself, or, when it's the first thing inside a box
  // (like the story card), the box, so the text doesn't drift inside it.
  function moverFor(el, root) {
    var m = el;
    while (!prevInFlow(m) && m.parentElement && m.parentElement !== root &&
           !m.parentElement.hasAttribute('data-snap')) {
      m = m.parentElement;
    }
    return m;
  }
  // Bottom of what's above: the bottom of its letters for text (a line box has
  // empty space under the letters), or its box for pictures.
  function bottomOf(el) {
    var box = el.getBoundingClientRect().bottom;
    if (el instanceof SVGElement || el.tagName === 'FIGURE' || el.tagName === 'IMG' || el.querySelector('img, svg')) return box;
    var last = edgeBlock(el, true);
    var letters = baselineAt(last, true) + parseFloat(getComputedStyle(last).fontSize) * 0.3;
    return Math.min(box, letters);
  }
  function roomAbove(m) {
    var prev = prevInFlow(m);
    var top = m.getBoundingClientRect().top;
    if (prev) return top - bottomOf(prev);
    var parent = m.parentElement;
    return top - parent.getBoundingClientRect().top - parseFloat(getComputedStyle(parent).borderTopWidth);
  }

  // Smallest move (up or down) that changes a position by `offset` modulo `period`.
  function nearest(offset, period) {
    var s = mod(offset, period);
    return s > period / 2 ? s - period : s;
  }

  function snapRoot(root) {
    // Undo the previous pass.
    (root._snapMoved || []).forEach(function (el) { el.style.marginTop = ''; });
    var moved = root._snapMoved = [];
    var all = Array.prototype.slice.call(root.querySelectorAll('[data-snap]'));
    root.style.translate = '';
    all.forEach(function (el) { el.style.marginTop = ''; el.style.translate = ''; el.style.lineHeight = ''; });

    var flow = [], free = [];
    all.forEach(function (el) {
      var placed = /absolute|fixed/.test(getComputedStyle(el).position) || el.hasAttribute('data-snap-free');
      (placed ? free : flow).push(el);
    });
    if (!flow.length) return;

    // Decide where the first block will land (to the full 96px pattern), then
    // space every other block to match.
    var anchor = flow[0];
    var a0 = measure(anchor);
    var pageY = a0.center + window.scrollY;
    var land = mod(pageY + nearest(a0.phase - pageY, a0.period), ROW);

    for (var i = 1; i < flow.length; i++) {
      var el = flow[i];
      var a = measure(anchor), m = measure(el);
      var r = mod((m.center - a.center) - (m.phase - land), m.period);
      var mover = moverFor(el, root);
      var delta = m.period - r;
      if (r <= m.period / 2 && roomAbove(mover) - r >= MIN_GAP) delta = -r;
      if (Math.abs(delta) > 0.5) {
        if (moved.indexOf(mover) < 0) moved.push(mover);
        // Margins can merge with a neighbor's margin, and a centered layout moves
        // everything when anything grows, so re-measure (relative to the first
        // block) and correct until the block really lands where it should.
        var target = m.center - a.center + delta;
        for (var tries = 0; tries < 6 && Math.abs(delta) > 0.5; tries++) {
          mover.style.marginTop = (parseFloat(getComputedStyle(mover).marginTop) + delta) + 'px';
          delta = target - (measure(el).center - measure(anchor).center);
        }
      }
    }

    // Nudge the whole container so the first block lands where planned.
    var y = measure(anchor).center + window.scrollY;
    var shift = nearest(land - y, ROW);
    if (root.getBoundingClientRect().top + shift < 0) shift += ROW;
    if (Math.abs(shift) > 0.5) root.style.translate = '0 ' + shift.toFixed(1) + 'px';

    // Then the free-floating blocks, each to its nearest spot.
    free.forEach(function (el) {
      var f = measure(el);
      var s = nearest(f.phase - (f.center + window.scrollY), f.period);
      if (Math.abs(s) > 0.5) el.style.translate = '0 ' + s.toFixed(1) + 'px';
    });
  }

  function snap() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-snap-root]'), snapRoot);
  }

  snap();
  // Re-check whenever anything could have moved the text: fonts arriving (a font
  // swap changes text size), the page finishing loading, or the layout resizing.
  if (document.fonts) {
    if (document.fonts.ready) document.fonts.ready.then(snap);
    if (document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', snap);
  }
  window.addEventListener('load', snap);
  // Re-align right away (not after a delay) so text never shows out of place.
  window.addEventListener('resize', snap);
  if (window.ResizeObserver) new ResizeObserver(snap).observe(document.body);
})();
