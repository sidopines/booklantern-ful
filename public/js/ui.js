// public/js/ui.js
(() => {
  console.log("✅ ui.js loaded");

  // ===============================
  // Carousel arrows (homepage)
  // ===============================
  document.querySelectorAll(".carousel").forEach(carousel => {
    const track = carousel.querySelector(".carousel-track");
    const prev = carousel.querySelector(".carousel-prev");
    const next = carousel.querySelector(".carousel-next");

    if (track && prev && next) {
      prev.addEventListener("click", () => {
        track.scrollBy({ left: -300, behavior: "smooth" });
      });
      next.addEventListener("click", () => {
        track.scrollBy({ left: 300, behavior: "smooth" });
      });
    }
  });

  // ===============================
  // Reader page setup
  // ===============================
  if (document.body.dataset.page === "reader") {
    const provider = document.body.dataset.provider;
    const bookId = document.body.dataset.bookId;

    const flow = document.getElementById("flow");
    const doc = document.getElementById("doc");
    const title = document.getElementById("r-title");
    const badge = document.getElementById("r-badge");

    // Load book content
    fetch(`/api/book?provider=${provider}&id=${bookId}`)
      .then(res => res.json())
      .then(data => {
        if (data && data.type === "html") {
          flow.hidden = false;
          flow.innerHTML = data.content;
        } else if (data && data.url) {
          doc.hidden = false;
          doc.src = data.url;
        }
        if (data && data.title) title.textContent = data.title;
        if (badge) badge.textContent = provider;
      })
      .catch(err => {
        console.error("Book load failed", err);
        flow.hidden = false;
        flow.textContent = "⚠️ Could not load book content.";
      });

    // ===============================
    // Listen button (TTS)
    // ===============================
    const listenBtn = document.getElementById("btn-listen");
    const rateSlider = document.getElementById("rate");
    let synth = window.speechSynthesis;
    let utterance = null;

    if (listenBtn) {
      listenBtn.addEventListener("click", () => {
        if (synth.speaking) {
          synth.cancel();
          listenBtn.setAttribute("aria-pressed", "false");
        } else if (flow && !flow.hidden) {
          utterance = new SpeechSynthesisUtterance(flow.innerText);
          utterance.rate = parseFloat(rateSlider.value || "1");
          synth.speak(utterance);
          listenBtn.setAttribute("aria-pressed", "true");
        }
      });
    }
    if (rateSlider) {
      rateSlider.addEventListener("input", () => {
        if (utterance) {
          utterance.rate = parseFloat(rateSlider.value);
          if (synth.speaking) {
            synth.cancel();
            synth.speak(utterance);
          }
        }
      });
    }

    // ===============================
    // Font size controls
    // ===============================
    let fontSize = 18;
    const decBtn = document.getElementById("btn-size-dec");
    const incBtn = document.getElementById("btn-size-inc");
    if (decBtn) decBtn.addEventListener("click", () => {
      fontSize = Math.max(14, fontSize - 2);
      flow.style.fontSize = fontSize + "px";
    });
    if (incBtn) incBtn.addEventListener("click", () => {
      fontSize = Math.min(28, fontSize + 2);
      flow.style.fontSize = fontSize + "px";
    });

    // ===============================
    // Theme toggle
    // ===============================
    const themeBtn = document.getElementById("btn-theme");
    if (themeBtn) {
      themeBtn.addEventListener("click", () => {
        document.body.classList.toggle("light");
      });
    }

    // ===============================
    // Bookmark + Save
    // ===============================
    const bookmarkBtn = document.getElementById("btn-bookmark");
    const savedBtn = document.getElementById("btn-saved");
    const key = `book-${provider}-${bookId}`;

    if (bookmarkBtn) {
      bookmarkBtn.addEventListener("click", () => {
        localStorage.setItem(`${key}-bookmark`, Date.now());
        alert("🔖 Bookmark saved!");
      });
    }
    if (savedBtn) {
      savedBtn.addEventListener("click", () => {
        const saved = savedBtn.getAttribute("aria-pressed") === "true";
        if (saved) {
          localStorage.removeItem(`${key}-saved`);
          savedBtn.setAttribute("aria-pressed", "false");
        } else {
          localStorage.setItem(`${key}-saved`, "true");
          savedBtn.setAttribute("aria-pressed", "true");
        }
      });
    }

    // ===============================
    // Notes panel
    // ===============================
    const notesBtn = document.getElementById("btn-notes");
    const notesPanel = document.getElementById("notes");
    const notesText = document.getElementById("notes-text");
    const notesSave = document.getElementById("btn-notes-save");
    const notesClose = document.getElementById("btn-notes-close");
    const notesStatus = document.getElementById("notes-status");

    if (notesBtn && notesPanel) {
      notesBtn.addEventListener("click", () => {
        notesPanel.classList.add("active");
      });
    }
    if (notesClose) {
      notesClose.addEventListener("click", () => {
        notesPanel.classList.remove("active");
      });
    }
    if (notesSave) {
      notesSave.addEventListener("click", () => {
        const text = notesText.value.trim();
        if (text) {
          localStorage.setItem(`${key}-notes`, text);
          notesStatus.textContent = "✅ Saved!";
          setTimeout(() => (notesStatus.textContent = ""), 2000);
        }
      });
    }
  }
})();
