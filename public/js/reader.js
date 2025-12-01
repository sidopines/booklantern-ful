// public/js/reader.js
(function () {
  const el = document.getElementById('viewer');
  if (!el) return;
  const url = el.getAttribute('data-epub');
  if (!url) { console.warn('[reader] no epub url'); return; }

  // Lazy load ePub.js if not present (CDN fallback)
  function ensureEPub(cb) {
    if (window.ePub) return cb();
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/epubjs@0.3/dist/epub.min.js';
    s.onload = cb;
    document.head.appendChild(s);
  }

  ensureEPub(function () {
    try {
      const book = ePub(url);
      const rendition = book.renderTo('viewer', { width: '100%', height: '80vh' });
      rendition.display();
    } catch (e) {
      console.error('[reader] failed to init epub', e);
      el.innerText = 'Failed to load book.';
    }
  });
})();
  
  // Load saved progress
  loadProgress();
  
  // Load TOC
  epubBook.loaded.navigation.then(nav => {
    const toc = nav.toc;
    const tocEl = document.getElementById('toc');
    toc.forEach(chapter => {
      const link = document.createElement('a');
      link.textContent = chapter.label;
      link.href = '#';
      link.onclick = (e) => {
        e.preventDefault();
        rendition.display(chapter.href);
      };
      tocEl.appendChild(link);
    });
  });
  
  // Navigation
  document.getElementById('prev-btn').onclick = () => rendition.prev();
  document.getElementById('next-btn').onclick = () => rendition.next();
  document.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight') rendition.next();
    if (e.key === 'ArrowLeft') rendition.prev();
  });
  
  // TOC sidebar
  document.getElementById('toc-btn').onclick = () => {
    document.getElementById('sidebar').classList.toggle('hidden');
  };
  document.getElementById('sidebar-close').onclick = () => {
    document.getElementById('sidebar').classList.add('hidden');
  };
  
  // Settings panel
  document.getElementById('settings-btn').onclick = () => {
    document.getElementById('settings-panel').classList.toggle('hidden');
  };
  document.querySelector('.panel-close').onclick = () => {
    document.getElementById('settings-panel').classList.add('hidden');
  };
  
  // Font size
  document.getElementById('font-decrease').onclick = () => {
    fontSize = Math.max(80, fontSize - 10);
    updateFontSize();
  };
  document.getElementById('font-increase').onclick = () => {
    fontSize = Math.min(150, fontSize + 10);
    updateFontSize();
  };
  
  function updateFontSize() {
    rendition.themes.fontSize(`${fontSize}%`);
    document.getElementById('font-size-display').textContent = `${fontSize}%`;
  }
  
  // Theme
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.onclick = () => {
      theme = btn.dataset.theme;
      document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyTheme();
    };
  });
  
  function applyTheme() {
    document.body.className = `theme-${theme}`;
    const themes = {
      light: { body: { background: '#fff', color: '#000' } },
      sepia: { body: { background: '#f4ecd8', color: '#5c4b37' } },
      dark: { body: { background: '#1a1a1a', color: '#e0e0e0' } }
    };
    rendition.themes.register(theme, themes[theme]);
    rendition.themes.select(theme);
  }
  
  // TTS
  document.getElementById('listen-btn').onclick = startTTS;
  document.getElementById('stop-listen-btn').onclick = stopTTS;
  
  function startTTS() {
    if ('speechSynthesis' in window) {
      rendition.getContents().forEach(contents => {
        const text = contents.document.body.innerText;
        utterance = new SpeechSynthesisUtterance(text);
        speechSynthesis.speak(utterance);
      });
      document.getElementById('listen-btn').classList.add('hidden');
      document.getElementById('stop-listen-btn').classList.remove('hidden');
    }
  }
  
  function stopTTS() {
    if (speechSynthesis.speaking) {
      speechSynthesis.cancel();
    }
    document.getElementById('listen-btn').classList.remove('hidden');
    document.getElementById('stop-listen-btn').classList.add('hidden');
  }
  
  // Save/unsave
  document.getElementById('save-btn').onclick = saveToLibrary;
  document.getElementById('unsave-btn').onclick = removeFromLibrary;
  
  async function saveToLibrary() {
    try {
      const res = await fetch('/api/library/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ book_id: book.book_id, title: book.title, author: book.author, cover_url: book.cover_url })
      });
      if (res.ok) {
        isSaved = true;
        document.getElementById('save-btn').classList.add('hidden');
        document.getElementById('unsave-btn').classList.remove('hidden');
      }
    } catch (e) {
      console.error('Save failed:', e);
    }
  }
  
  async function removeFromLibrary() {
    try {
      const res = await fetch('/api/library/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ book_id: book.book_id })
      });
      if (res.ok) {
        isSaved = false;
        document.getElementById('save-btn').classList.remove('hidden');
        document.getElementById('unsave-btn').classList.add('hidden');
      }
    } catch (e) {
      console.error('Remove failed:', e);
    }
  }
  
  // Progress tracking
  rendition.on('relocated', loc => {
    currentCfi = loc.start.cfi;
    const percent = Math.round(epubBook.locations.percentageFromCfi(currentCfi) * 100);
    document.getElementById('progress-text').textContent = `${percent}%`;
    saveProgress(currentCfi, percent);
  });
  
  let saveTimeout;
  function saveProgress(cfi, percent) {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(async () => {
      try {
        await fetch('/api/reader/progress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ book_id: book.book_id, cfi, progress_percent: percent })
        });
        localStorage.setItem(`progress_${book.book_id}`, JSON.stringify({ cfi, percent }));
      } catch (e) {
        console.error('Save progress failed:', e);
      }
    }, 2000);
  }
  
  async function loadProgress() {
    try {
      const res = await fetch(`/api/reader/progress/${encodeURIComponent(book.book_id)}`);
      const data = await res.json();
      if (data.cfi) {
        rendition.display(data.cfi);
      } else {
        const local = localStorage.getItem(`progress_${book.book_id}`);
        if (local) {
          const { cfi } = JSON.parse(local);
          rendition.display(cfi);
        } else {
          rendition.display();
        }
      }
    } catch (e) {
      console.error('Load progress failed:', e);
      rendition.display();
    }
  }
  
  // Bookmarks
  document.getElementById('bookmark-btn').onclick = addBookmark;
  
  async function addBookmark() {
    if (!currentCfi) return;
    const label = prompt('Bookmark label:', 'Bookmark');
    if (!label) return;
    try {
      await fetch('/api/reader/bookmark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ book_id: book.book_id, cfi: currentCfi, label })
      });
      alert('Bookmark added!');
    } catch (e) {
      console.error('Add bookmark failed:', e);
    }
  }
  
  // Initial setup
  applyTheme();
  updateFontSize();
})();
