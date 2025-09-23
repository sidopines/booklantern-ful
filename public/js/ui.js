// ui.js — BookLantern frontend interactivity

// ===============
// Carousel scroll
// ===============
document.addEventListener('click', e => {
  if (e.target.matches('.carousel-btn')) {
    const btn = e.target;
    const targetSel = btn.getAttribute('data-target');
    const track = document.querySelector(targetSel);
    if (!track) return;

    const scrollBy = 220; // px to scroll per click
    if (btn.classList.contains('prev')) {
      track.scrollBy({ left: -scrollBy, behavior: 'smooth' });
    } else {
      track.scrollBy({ left: scrollBy, behavior: 'smooth' });
    }
  }
});

// ===================
// Listen (Text-to-Speech)
// ===================
let synth;
try {
  synth = window.speechSynthesis;
} catch {
  synth = null;
}

function speakText(text) {
  if (!synth) return alert("Text-to-speech not supported in this browser.");
  if (synth.speaking) synth.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "en-US";
  utter.rate = 1.05;
  utter.pitch = 1.0;
  synth.speak(utter);
}

document.addEventListener('click', e => {
  if (e.target.closest('.btn-listen')) {
    const btn = e.target.closest('.btn-listen');
    const title = btn.dataset.title || "Unknown";
    const author = btn.dataset.author || "";
    const text = `${title}. ${author}`;
    speakText(text);
  }
});

// ======================
// Cover fallback (global)
// ======================
window.blCoverFallback = function(imgEl) {
  if (!imgEl) return;
  imgEl.replaceWith(Object.assign(document.createElement('div'), {
    className: 'cover ph',
    innerHTML: `<span class="ph-initials">BL</span>`
  }));
};
