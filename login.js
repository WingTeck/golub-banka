// Inicijalizacija podataka banke u localStorage
// Ova funkcija će se pozvati samo ako podaci već ne postoje
function initializeBankData() {
    let bankData = localStorage.getItem('golubBankaData');
    if (!bankData) {
        const initialData = {
            pigeons: {}, // Mapa golubova, ključ je username
            nextPigeonID: 1 // Brojač za generisanje ID-eva i brojeva kartica
        };
        localStorage.setItem('golubBankaData', JSON.stringify(initialData));
        console.log('Bank data initialized in localStorage.');
    } else {
        console.log('Bank data already exists in localStorage.');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initializeBankData(); // Pozovi inicijalizaciju pri učitavanju stranice

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

    loginBtn.addEventListener('click', () => {
        const username = usernameInput.value.trim();
        const password = passwordInput.value.trim();

        if (!username || !password) {
            showMessage('Molimo unesite korisničko ime i lozinku goluba.', 'error');
            return;
        }

        let bankData = JSON.parse(localStorage.getItem('golubBankaData'));
        const pigeon = bankData.pigeons[username];

        if (pigeon && pigeon.password === password) { // Jednostavna provera lozinke
            localStorage.setItem('golubBankaPigeonID', pigeon.id);
            localStorage.setItem('golubBankaPigeonUsername', pigeon.username);
            showMessage('Uspešno ste se prijavili kao golub!', 'success');
            window.location.href = 'index.html'; // Preusmeri na glavnu stranicu
        } else {
            showMessage('Nevažeće korisničko ime goluba ili lozinka.', 'error');
        }
    });

    registerBtn.addEventListener('click', () => {
        const username = usernameInput.value.trim();
        const password = passwordInput.value.trim();

        if (!username || !password) {
            showMessage('Molimo unesite korisničko ime i lozinku goluba.', 'error');
            return;
        }

        let bankData = JSON.parse(localStorage.getItem('golubBankaData'));

        if (bankData.pigeons[username]) {
            showMessage('Korisničko ime goluba već postoji.', 'error');
            return;
        }

        const newPigeonID = `PIGEON-${String(bankData.nextPigeonID).padStart(4, '0')}`;
        const newCardNumber = String(bankData.nextPigeonID).padStart(16, '0');

        const newPigeon = {
            id: newPigeonID,
            username: username,
            password: password, // Čuvanje lozinke u plain tekstu (NIJE BEZBEDNO ZA PRAVE APLIKACIJE)
            cardNumber: newCardNumber,
            balance: 0.00,
            transactions: []
        };

        bankData.pigeons[username] = newPigeon;
        bankData.nextPigeonID++;
        localStorage.setItem('golubBankaData', JSON.stringify(bankData));

        showMessage('Uspešno ste registrovali goluba! Sada se možete prijaviti.', 'success');
        usernameInput.value = '';
        passwordInput.value = '';
    });
});
