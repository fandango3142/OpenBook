(() => {
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');

  function startCarousel(root) {
    const wizard = root.hasAttribute('data-setup-wizard');
    const levelField = wizard ? document.querySelector('[data-setup-level]') : null;
    const levelButtons = levelField ? [...levelField.querySelectorAll('[data-level-choice]')] : [];
    let level = root.dataset.level || 'technical';

    function updateLevel(nextLevel) {
      if (!['technical', 'plain'].includes(nextLevel)) return;
      level = nextLevel;
      root.dataset.level = level;
      for (const button of levelButtons) {
        button.setAttribute('aria-pressed', String(button.dataset.levelChoice === level));
      }
      for (const copy of root.querySelectorAll('[data-level-copy]')) {
        copy.hidden = copy.dataset.levelCopy !== level;
      }
      for (const details of root.querySelectorAll('[data-technical-details]')) {
        details.open = false;
      }
      const summary = levelField?.querySelector('[data-level-summary]');
      if (summary) summary.textContent = level === 'technical'
        ? 'You’ll see the technical steps and exact settings for this disposable setup.'
        : 'You’ll see each action explained simply. Open “Detailed actions and reference” for the exact technical instructions.';
    }

    if (levelField) {
      levelField.hidden = false;
      levelButtons.forEach((button) => button.addEventListener('click', () => {
        updateLevel(button.dataset.levelChoice);
        root.scrollIntoView({ behavior: reducedMotion?.matches ? 'auto' : 'smooth', block: 'start' });
      }));
      updateLevel(level);
    }

    const name = root.dataset.carousel;
    const slides = [...root.querySelectorAll(`[data-slide="${name}"]`)];
    const controls = root.querySelector('.carousel-controls');
    if (slides.length < 2 || !controls) return;

    root.classList.add('carousel-enhanced');
    controls.hidden = false;
    let current = 0;
    let timer;
    let userPaused = false;
    let pointerInside = false;
    let focusInside = false;
    let inView = true;
    const counter = controls.querySelector('[data-counter]');
    const pauseButton = controls.querySelector('[data-pause]');
    const dots = controls.querySelector('[data-dots]');
    const stepLinks = wizard ? [...root.querySelectorAll('[data-step-link]')] : [];
    const previousButton = controls.querySelector('[data-previous]');
    const nextButton = controls.querySelector('[data-next]');

    function updatePauseControl() {
      if (!pauseButton) return;
      pauseButton.setAttribute('aria-pressed', String(userPaused));
      const pausedLabel = userPaused ? 'Start automatic slide show' : 'Pause automatic slide show';
      pauseButton.setAttribute('aria-label', pausedLabel);
      const icon = pauseButton.querySelector('img');
      if (icon) icon.src = userPaused ? 'assets/play.svg' : 'assets/pause.svg';
    }

    function stopTimer() {
      if (timer) window.clearInterval(timer);
      timer = undefined;
    }

    function syncTimer() {
      stopTimer();
      const willAutoplay = root.dataset.autoplay === 'true' && !reducedMotion?.matches && !userPaused && !pointerInside && !focusInside && inView && !document.hidden;
      if (counter) counter.setAttribute('aria-live', willAutoplay ? 'off' : 'polite');
      if (!willAutoplay) return;
      timer = window.setInterval(() => show(current + 1), 6500);
    }

    function show(index) {
      current = wizard ? Math.max(0, Math.min(index, slides.length - 1)) : (index + slides.length) % slides.length;
      slides.forEach((slide, slideIndex) => {
        slide.hidden = slideIndex !== current;
        slide.setAttribute('aria-current', slideIndex === current ? (wizard ? 'step' : 'true') : 'false');
      });
      if (counter) counter.textContent = `${current + 1} of ${slides.length}`;
      if (wizard) {
        if (previousButton) previousButton.disabled = current === 0;
        if (nextButton) nextButton.disabled = current === slides.length - 1;
      }
      stepLinks.forEach((link, linkIndex) => {
        if (linkIndex === current) link.setAttribute('aria-current', 'step');
        else link.removeAttribute('aria-current');
        link.classList.toggle('is-complete', linkIndex < current);
      });
      if (dots) {
        [...dots.children].forEach((dot, dotIndex) => {
          if (dotIndex === current) dot.setAttribute('aria-current', 'true');
          else dot.removeAttribute('aria-current');
        });
      }
      syncTimer();
    }

    if (dots) {
      const kind = root.dataset.dotLabel || 'slide';
      slides.forEach((slide, index) => {
        const heading = slide.querySelector('h2, h3')?.textContent.trim() || `${kind} ${index + 1}`;
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'carousel-dot';
        dot.setAttribute('aria-label', `Go to ${kind} ${index + 1}: ${heading}`);
        dot.addEventListener('click', () => show(index));
        const visual = document.createElement('span');
        visual.setAttribute('aria-hidden', 'true');
        dot.append(visual);
        dots.append(dot);
      });
    }

    previousButton?.addEventListener('click', () => show(current - 1));
    nextButton?.addEventListener('click', () => show(current + 1));
    stepLinks.forEach((link, index) => link.addEventListener('click', () => show(index)));
    pauseButton?.addEventListener('click', () => {
      userPaused = !userPaused;
      updatePauseControl();
      syncTimer();
    });
    root.addEventListener('pointerenter', () => { pointerInside = true; syncTimer(); });
    root.addEventListener('pointerleave', () => { pointerInside = false; syncTimer(); });
    root.addEventListener('focusin', () => { focusInside = true; syncTimer(); });
    root.addEventListener('focusout', (event) => {
      if (!root.contains(event.relatedTarget)) {
        focusInside = false;
        syncTimer();
      }
    });
    document.addEventListener('visibilitychange', syncTimer);
    reducedMotion?.addEventListener?.('change', syncTimer);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(([entry]) => {
        inView = entry.isIntersecting;
        syncTimer();
      }).observe(root);
    }
    updatePauseControl();
    show(0);
  }

  document.querySelectorAll('[data-carousel]').forEach(startCarousel);
})();
