document.addEventListener('DOMContentLoaded', () => {
    initSeasonalHero();
    initScrollAnimations();
});

/* --- Seasonal Hero Logic --- */
function initSeasonalHero() {
    const images = document.querySelectorAll('.hero-img');
    const seasonOrder = ['spring', 'summer', 'fall', 'winter', 'night'];
    let currentIndex = 0;

    // 1. Determine Current Season
    const month = new Date().getMonth(); // 0-11
    let currentSeason = 'winter'; // Default

    if (month >= 2 && month <= 4) currentSeason = 'spring';
    else if (month >= 5 && month <= 7) currentSeason = 'summer';
    else if (month >= 8 && month <= 10) currentSeason = 'fall';

    // Set initial active image
    currentIndex = seasonOrder.indexOf(currentSeason);
    if (currentIndex === -1) currentIndex = 0;

    activateImage(currentIndex);

    // 2. Cycle Interval (10s)
    setInterval(() => {
        currentIndex = (currentIndex + 1) % seasonOrder.length;
        activateImage(currentIndex);
    }, 10000);

    function activateImage(index) {
        images.forEach(img => img.classList.remove('active'));
        // Find image with the corresponding class
        const seasonClass = seasonOrder[index];
        const nextImg = document.querySelector(`.hero-img.${seasonClass}`);
        if (nextImg) nextImg.classList.add('active');
    }
}

/* --- Scroll Animations --- */
function initScrollAnimations() {
    const observerOptions = {
        threshold: 0.1,
        rootMargin: "0px 0px -50px 0px"
    };

    const observer = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                observer.unobserve(entry.target); // Only animate once
            }
        });
    }, observerOptions);

    const elements = document.querySelectorAll('.fade-in');
    elements.forEach(el => observer.observe(el));
}

/* --- Form Handling --- */
function handleHeroSubmit() {
    const input = document.getElementById('concernInput');
    const value = input.value.toLowerCase();
    const heroContent = document.querySelector('.hero-content');
    const heroResponse = document.getElementById('heroResponse');
    const responseText = document.getElementById('responseText');

    // 1. Determine Message
    let message = "We see the potential in every tree. Let's make sure yours is safe and beautiful."; // Default

    if (value.includes('storm') || value.includes('damage') || value.includes('branch')) {
        message = "That tree could turn a storm into a story of strength. We'll make it safe.";
    } else if (value.includes('prune') || value.includes('trim') || value.includes('cut')) {
        message = "Proper pruning breathes life back. Your yard will thrive again.";
    } else if (value.includes('stump') || value.includes('remove')) {
        message = "We'll erase the trace, but leave the memory. Clean, safe removal.";
    }

    // 2. Update Text
    responseText.textContent = message;

    // 3. Animate Transition
    heroContent.style.opacity = '0';
    heroContent.style.transform = 'translateY(-20px)';
    heroContent.style.transition = 'all 0.5s ease';

    setTimeout(() => {
        heroResponse.classList.add('visible');
        // Scroll slightly if needed to frame it
    }, 500);
}

function closeHeroResponse() {
    const heroContent = document.querySelector('.hero-content');
    const heroResponse = document.getElementById('heroResponse');

    // 1. Hide Modal
    heroResponse.classList.remove('visible');

    // 2. Restore Hero Content
    setTimeout(() => {
        heroContent.style.opacity = '1';
        heroContent.style.transform = 'translateY(0)';
    }, 300);
}
