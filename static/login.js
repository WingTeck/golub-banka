document.addEventListener('DOMContentLoaded', () => {
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const loginBtn = document.getElementById('loginBtn');
    const registerBtn = document.getElementById('registerBtn');
    const messageBox = document.getElementById('messageBox');

    function showMessage(message, type) {
        messageBox.textContent = message;
        messageBox.className = `message-box ${type}`;
        messageBox.style.display = 'block';
        setTimeout(() => {
            messageBox.style.display = 'none';
        }, 5000);
    }

    loginBtn.addEventListener('click', async () => {
        const username = usernameInput.value.trim();
        const password = passwordInput.value.trim();

        if (!username || !password) {
            showMessage('Molimo unesite korisničko ime i lozinku.', 'error');
            return;
        }

        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, password })
            });
            const data = await response.json();
            if (data.success) {
                localStorage.setItem('golubBankaToken', data.token); // Sačuvaj token
                localStorage.setItem('golubBankaUserID', data.userId); // Sačuvaj korisnički ID
                localStorage.setItem('golubBankaUsername', username); // Sačuvaj korisničko ime
                showMessage('Uspešno ste se prijavili!', 'success');
                window.location.href = '/'; // Preusmeri na glavnu stranicu
            } else {
                showMessage(`Greška pri prijavi: ${data.message}`, 'error');
            }
        } catch (error) {
            console.error('Greška pri prijavi:', error);
            showMessage('Došlo je do greške pri povezivanju sa serverom.', 'error');
        }
    });

    registerBtn.addEventListener('click', async () => {
        const username = usernameInput.value.trim();
        const password = passwordInput.value.trim();

        if (!username || !password) {
            showMessage('Molimo unesite korisničko ime i lozinku.', 'error');
            return;
        }

        try {
            const response = await fetch('/api/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, password })
            });
            const data = await response.json();
            if (data.success) {
                showMessage('Uspešno ste se registrovali! Sada se možete prijaviti.', 'success');
                usernameInput.value = '';
                passwordInput.value = '';
            } else {
                showMessage(`Greška pri registraciji: ${data.message}`, 'error');
            }
        } catch (error) {
            console.error('Greška pri registraciji:', error);
            showMessage('Došlo je do greške pri povezivanju sa serverom.', 'error');
        }
    });
});
