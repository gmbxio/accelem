const menuToggle = document.querySelector('.menu-toggle');
const mainNav = document.querySelector('.main-nav');
const passwordToggle = document.querySelector('.password-toggle');
const passwordInput = document.querySelector('#password');
const loginForm = document.querySelector('#login-form');
const formMessage = document.querySelector('#form-message');
const dialogs = document.querySelectorAll('.site-dialog');

function wirePasswordToggle(toggle, input) {
    toggle.addEventListener('click', () => {
        const shouldShow = input.type === 'password';
        input.type = shouldShow ? 'text' : 'password';
        toggle.textContent = shouldShow ? 'Hide' : 'Show';
        toggle.setAttribute('aria-label', shouldShow ? 'Hide password' : 'Show password');
        toggle.setAttribute('aria-pressed', String(shouldShow));
    });
}

document.querySelectorAll('[data-dialog]').forEach((trigger) => {
    trigger.addEventListener('click', (event) => {
        event.preventDefault();
        document.querySelector(`#${trigger.dataset.dialog}`).showModal();
        mainNav.classList.remove('is-open');
    });
});

document.querySelectorAll('.dialog-close').forEach((button) => {
    button.addEventListener('click', () => button.closest('dialog').close());
});

dialogs.forEach((dialog) => {
    dialog.addEventListener('click', (event) => {
        if (event.target === dialog) dialog.close();
    });
});

document.querySelectorAll('.dialog-form').forEach((form) => {
    form.addEventListener('submit', (event) => {
        event.preventDefault();
        const message = form.querySelector('.form-message');
        const endpoint = form.id === 'signup-form' ? '/api/auth/signup' : '/api/auth/reset';
        fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form))) })
            .then(async (response) => {
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || 'Something went wrong.');
                message.textContent = form.id === 'signup-form' ? 'Account created. Opening your workspace...' : 'If that email exists, reset instructions are on their way.';
                if (form.id === 'signup-form') setTimeout(() => { window.location.href = '/dashboard.html'; }, 600);
                form.reset();
            })
            .catch((error) => { message.textContent = error.message; });
    });
});

menuToggle.addEventListener('click', () => {
    const isOpen = mainNav.classList.toggle('is-open');
    menuToggle.setAttribute('aria-expanded', String(isOpen));
    menuToggle.setAttribute('aria-label', isOpen ? 'Close navigation' : 'Open navigation');
});

wirePasswordToggle(passwordToggle, passwordInput);
wirePasswordToggle(document.querySelector('.signup-password-toggle'), document.querySelector('#signup-password'));

loginForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const email = document.querySelector('#email');
    const emailError = document.querySelector('#email-error');
    const passwordError = document.querySelector('#password-error');
    emailError.textContent = '';
    passwordError.textContent = '';
    formMessage.textContent = '';

    let isValid = true;
    if (!email.validity.valid) {
        emailError.textContent = 'Please enter a valid email address.';
        isValid = false;
    }
    if (!passwordInput.value || passwordInput.value.length < 8) {
        passwordError.textContent = 'Your password must be at least 8 characters.';
        isValid = false;
    }
    if (!isValid) return;
    fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.value, password: passwordInput.value }) })
        .then(async (response) => {
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Login failed.');
            window.location.href = data.user.role === 'admin' ? '/admin.html' : '/dashboard.html';
        })
        .catch((error) => { formMessage.textContent = error.message; });
});