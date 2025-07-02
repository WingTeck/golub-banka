document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('golubBankaToken');
    const userId = localStorage.getItem('golubBankaUserID');
    const loggedInUsername = localStorage.getItem('golubBankaUsername');

    console.log('DOMContentLoaded fired. Token:', token ? 'Present' : 'Missing', 'UserID:', userId ? 'Present' : 'Missing', 'Username:', loggedInUsername ? 'Present' : 'Missing');

    // Proveri da li je korisnik prijavljen
    if (!token || !userId || !loggedInUsername) {
        console.log('User not authenticated, redirecting to /login');
        window.location.href = '/login'; // Preusmeri na stranicu za prijavu ako nije prijavljen
        return; // Prekini izvršavanje skripte
    }

    // Dobij DOM elemente
    const createAccountNameInput = document.getElementById('createAccountName');
    const createAccountBtn = document.getElementById('createAccountBtn');
    const accountIdOrCardInput = document.getElementById('accountIdOrCard');
    const amountInput = document.getElementById('amount');
    const depositBtn = document.getElementById('depositBtn');
    const withdrawBtn = document.getElementById('withdrawBtn'); // Ispravljena greška u dodeli
    const viewAccountBtn = document.getElementById('viewAccountBtn');
    const viewAllAccountsBtn = document.getElementById('viewAllAccountsBtn');
    const allAccountsList = document.getElementById('allAccountsList');
    const noAccountsMessage = document.getElementById('noAccountsMessage');
    const messageBox = document.getElementById('messageBox');
    const logoutBtn = document.getElementById('logoutBtn');

    // Pomoćna funkcija za prikaz poruka
    function showMessage(message, type) {
        console.log(`Displaying message: [${type}] ${message}`); // Dodatno logovanje
        messageBox.textContent = message;
        messageBox.className = `message-box ${type}`; // Primeni klasu uspeha ili greške
        messageBox.style.display = 'block'; // Prikaži okvir za poruke
        setTimeout(() => {
            messageBox.style.display = 'none'; // Sakrij nakon 5 sekundi
        }, 5000);
    }

    // Pomoćna funkcija za slanje autorizovanih zahteva
    async function authorizedFetch(url, options = {}) {
        options.headers = {
            ...options.headers,
            'Authorization': token // Dodaj token u zaglavlje
        };
        console.log(`Sending authorized fetch to: ${url} with options:`, options); // Dodatno logovanje
        try {
            const response = await fetch(url, options);
            console.log(`Received response for ${url}: Status ${response.status}`); // Dodatno logovanje
            // Ako je token istekao ili je nevažeći, preusmeri na prijavu
            if (response.status === 401 || response.status === 403) {
                showMessage('Vaša sesija je istekla ili nemate dozvolu. Molimo prijavite se ponovo.', 'error');
                localStorage.removeItem('golubBankaToken');
                localStorage.removeItem('golubBankaUserID');
                localStorage.removeItem('golubBankaUsername');
                setTimeout(() => {
                    window.location.href = '/login';
                }, 2000);
                return null; // Vrati null da signalizira grešku autentifikacije
            }
            return response;
        } catch (error) {
            console.error(`Network error during authorized fetch to ${url}:`, error); // Logovanje greške mreže
            showMessage('Došlo je do greške pri povezivanju sa serverom. Proverite konzolu za detalje.', 'error');
            return null;
        }
    }

    // Pomoćna funkcija za renderovanje pojedinačnog računa
    function renderAccount(account, targetElement) {
        const accountDiv = document.createElement('div');
        accountDiv.className = 'account-list-item';
        accountDiv.innerHTML = `
            <div class="account-details">
                <span class="font-medium text-gray-800">${account.Name}</span>
                <span class="account-id-card">ID: ${account.ID} | Kartica: ${account.CardNumber}</span>
            </div>
            <span class="font-bold text-indigo-600">${account.Balance.toFixed(2)} Žita</span>
        `;
        targetElement.appendChild(accountDiv);
    }

    // Funkcija za dobijanje ID-a računa na osnovu unetog identifikatora
    async function resolveAccountIdentifier(inputIdentifier) {
        console.log('Attempting to resolve identifier:', inputIdentifier); // Dodatno logovanje
        if (inputIdentifier === loggedInUsername) {
            // Ako je uneto korisničko ime, pokušaj da pronađeš prvi račun za tog korisnika
            console.log('Identifier is username. Fetching all accounts for user.'); // Dodatno logovanje
            const response = await authorizedFetch('/api/accounts');
            if (!response) return null;
            const data = await response.json();

            if (data.success && data.Data && data.Data.length > 0) {
                if (data.Data.length > 1) {
                    showMessage('Pronađeno je više računa za vaše korisničko ime. Operacija će biti izvršena na prvom pronađenom računu. Za specifične račune koristite ID ili broj kartice.', 'info');
                }
                console.log('Resolved username to account ID:', data.Data[0].ID); // Dodatno logovanje
                return { type: 'id', value: data.Data[0].ID };
            } else {
                showMessage('Nema računa povezanih sa ovim korisničkim imenom.', 'error');
                console.log('No accounts found for this username.'); // Dodatno logovanje
                return null;
            }
        } else if (inputIdentifier.startsWith('PIGEON-')) {
            console.log('Identifier is a Pigeon ID.'); // Dodatno logovanje
            return { type: 'id', value: inputIdentifier };
        } else if (!isNaN(inputIdentifier) && inputIdentifier.length === 16) { // Pretpostavi 16-cifreni broj kartice
            console.log('Identifier is a Card Number.'); // Dodatno logovanje
            return { type: 'cardNumber', value: inputIdentifier };
        } else {
            showMessage('Nevažeći unos. Molimo unesite svoje korisničko ime, ID računa (npr. PIGEON-0001) ili 16-cifreni broj kartice.', 'error');
            console.log('Invalid identifier format.'); // Dodatno logovanje
            return null;
        }
    }

    // Slušači događaja

    // Kreiraj Račun
    createAccountBtn.addEventListener('click', async () => {
        console.log('Create Account button clicked.'); // Dodatno logovanje
        const name = createAccountNameInput.value.trim();
        if (!name) {
            showMessage('Molimo unesite ime goluba.', 'error');
            console.log('Create account: Name input is empty.'); // Dodatno logovanje
            return;
        }
        console.log('Attempting to create account for:', name); // Dodatno logovanje

        try {
            const response = await authorizedFetch('/api/create-account', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ name })
            });

            if (!response) {
                console.log('Create account: authorizedFetch returned null (auth issue or network error).'); // Dodatno logovanje
                return; // Prekini ako je došlo do greške autentifikacije ili mrežne greške
            }

            const data = await response.json();
            console.log('Create account API response (raw):', JSON.stringify(data, null, 2)); // Logovanje celog JSON odgovora

            if (data.success && data.Data) { // Proveri da li je data.Data definisano
                showMessage(`Račun za ${data.Data.Name} kreiran! ID: ${data.Data.ID}, Kartica: ${data.Data.CardNumber}`, 'success');
                createAccountNameInput.value = ''; // Obriši unos
                accountIdOrCardInput.value = data.Data.ID; // Postavi novi ID računa u polje za operacije
                viewAllAccountsBtn.click(); // Osveži listu svih računa
            } else if (data.success && !data.Data) {
                // Slučaj kada je success true, ali Data je undefined/null
                showMessage(`Račun je kreiran, ali detalji nisu primljeni. Molimo osvežite listu računa.`, 'info');
                createAccountNameInput.value = ''; // Obriši unos
                viewAllAccountsBtn.click(); // Osveži listu svih računa
            }
            else {
                showMessage(`Greška pri kreiranju računa: ${data.message}`, 'error');
            }
        } catch (error) {
            console.error('Greška pri kreiranju računa (JavaScript error):', error); // Logovanje JavaScript greške
            showMessage('Došlo je do greške pri povezivanju sa serverom. Proverite konzolu za detalje.', 'error');
        }
    });

    // Uplati Žito
    depositBtn.addEventListener('click', async () => {
        console.log('Deposit button clicked.'); // Dodatno logovanje
        const inputIdentifier = accountIdOrCardInput.value.trim();
        const amount = parseFloat(amountInput.value);

        if (!inputIdentifier || isNaN(amount) || amount <= 0) {
            showMessage('Molimo unesite validan identifikator računa i pozitivan iznos žita.', 'error');
            console.log('Deposit: Invalid input identifier or amount.'); // Dodatno logovanje
            return;
        }

        const resolvedIdentifier = await resolveAccountIdentifier(inputIdentifier);
        if (!resolvedIdentifier) {
            console.log('Deposit: Could not resolve account identifier.'); // Dodatno logovanje
            return;
        }

        const payload = { amount: amount };
        if (resolvedIdentifier.type === 'id') {
            payload.id = resolvedIdentifier.value;
        } else {
            payload.cardNumber = resolvedIdentifier.value;
        }
        console.log('Deposit payload:', payload); // Dodatno logovanje

        try {
            const response = await authorizedFetch('/api/deposit', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (!response) {
                console.log('Deposit: authorizedFetch returned null (auth issue).'); // Dodatno logovanje
                return;
            }

            const data = await response.json();
            console.log('Deposit API response:', data); // Logovanje API odgovora
            if (data.success) {
                showMessage(`Uplaćeno ${amount.toFixed(2)} žita na račun ${data.Data.Name} (${data.Data.ID}). Novo stanje: ${data.Data.Balance.toFixed(2)}`, 'success');
                amountInput.value = ''; // Obriši unos iznosa
                viewAllAccountsBtn.click(); // Osveži listu svih računa
            } else {
                showMessage(`Greška pri uplati: ${data.message}`, 'error');
            }
        } catch (error) {
            console.error('Greška pri uplati (JavaScript error):', error); // Logovanje JavaScript greške
            showMessage('Došlo je do greške pri povezivanju sa serverom.', 'error');
        }
    });

    // Podigni Žito
    withdrawBtn.addEventListener('click', async () => {
        console.log('Withdraw button clicked.'); // Dodatno logovanje
        const inputIdentifier = accountIdOrCardInput.value.trim();
        const amount = parseFloat(amountInput.value);

        if (!inputIdentifier || isNaN(amount) || amount <= 0) {
            showMessage('Molimo unesite validan identifikator računa i pozitivan iznos žita.', 'error');
            console.log('Withdraw: Invalid input identifier or amount.'); // Dodatno logovanje
            return;
        }

        const resolvedIdentifier = await resolveAccountIdentifier(inputIdentifier);
        if (!resolvedIdentifier) {
            console.log('Withdraw: Could not resolve account identifier.'); // Dodatno logovanje
            return;
        }

        const payload = { amount: amount };
        if (resolvedIdentifier.type === 'id') {
            payload.id = resolvedIdentifier.value;
        } else {
            payload.cardNumber = resolvedIdentifier.value;
        }
        console.log('Withdraw payload:', payload); // Dodatno logovanje

        try {
            const response = await authorizedFetch('/api/withdraw', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (!response) {
                console.log('Withdraw: authorizedFetch returned null (auth issue).'); // Dodatno logovanje
                return;
            }

            const data = await response.json();
            console.log('Withdraw API response:', data); // Logovanje API odgovora
            if (data.success) {
                showMessage(`Podignuto ${amount.toFixed(2)} žita sa računa ${data.Data.Name} (${data.Data.ID}). Novo stanje: ${data.Data.Balance.toFixed(2)}`, 'success');
                amountInput.value = ''; // Obriši unos iznosa
                viewAllAccountsBtn.click(); // Osveži listu svih računa
            } else {
                showMessage(`Greška pri podizanju: ${data.message}`, 'error');
            }
        } catch (error) {
            console.error('Greška pri podizanju (JavaScript error):', error); // Logovanje JavaScript greške
            showMessage('Došlo je do greške pri povezivanju sa serverom.', 'error');
        }
    });

    // Pogledaj Specifičan Račun
    viewAccountBtn.addEventListener('click', async () => {
        console.log('View Account button clicked.'); // Dodatno logovanje
        const inputIdentifier = accountIdOrCardInput.value.trim();
        if (!inputIdentifier) {
            showMessage('Molimo unesite identifikator računa za pregled.', 'error');
            console.log('View account: Input identifier is empty.'); // Dodatno logovanje
            return;
        }

        const resolvedIdentifier = await resolveAccountIdentifier(inputIdentifier);
        if (!resolvedIdentifier) {
            console.log('View account: Could not resolve account identifier.'); // Dodatno logovanje
            return;
        }

        let url = `/api/accounts?`;
        if (resolvedIdentifier.type === 'id') {
            url += `id=${resolvedIdentifier.value}`;
        } else {
            url += `cardNumber=${resolvedIdentifier.value}`;
        }
        console.log('View account URL:', url); // Dodatno logovanje

        try {
            const response = await authorizedFetch(url);
            if (!response) {
                console.log('View account: authorizedFetch returned null (auth issue).'); // Dodatno logovanje
                return;
            }

            const data = await response.json();
            console.log('View account API response:', data); // Logovanje API odgovora
            allAccountsList.innerHTML = ''; // Obriši prethodnu listu
            noAccountsMessage.style.display = 'none';

            if (data.success) {
                renderAccount(data.Data, allAccountsList);
                showMessage(`Detalji računa za ${data.Data.Name} (${data.Data.ID}) učitani.`, 'success');
            } else {
                noAccountsMessage.style.display = 'block'; // Prikaži poruku da nema računa
                showMessage(`Greška pri učitavanju računa: ${data.message}`, 'error');
            }
        } catch (error) {
            console.error('Greška pri pregledu računa (JavaScript error):', error); // Logovanje JavaScript greške
            showMessage('Došlo je do greške pri povezivanju sa serverom.', 'error');
        }
    });

    // Pogledaj Sve Račune
    viewAllAccountsBtn.addEventListener('click', async () => {
        console.log('View All Accounts button clicked.'); // Dodatno logovanje
        try {
            const response = await authorizedFetch('/api/accounts');
            if (!response) {
                console.log('View all accounts: authorizedFetch returned null (auth issue).'); // Dodatno logovanje
                return;
            }

            const data = await response.json();
            console.log('View all accounts API response:', data); // Logovanje API odgovora
            allAccountsList.innerHTML = ''; // Obriši prethodnu listu

            if (data.success && data.Data && data.Data.length > 0) {
                noAccountsMessage.style.display = 'none';
                data.Data.forEach(account => renderAccount(account, allAccountsList));
                showMessage('Svi vaši računi uspešno učitani.', 'success');
            } else {
                noAccountsMessage.style.display = 'block';
                showMessage('Nema dostupnih računa za ovog korisnika.', 'info');
            }
        } catch (error) {
            console.error('Greška pri pregledu svih računa (JavaScript error):', error); // Logovanje JavaScript greške
            showMessage('Došlo je do greške pri povezivanju sa serverom.', 'error');
        }
    });

    // Dugme za odjavu
    logoutBtn.addEventListener('click', () => {
        console.log('Logout button clicked.'); // Dodatno logovanje
        localStorage.removeItem('golubBankaToken');
        localStorage.removeItem('golubBankaUserID');
        localStorage.removeItem('golubBankaUsername');
        window.location.href = '/login'; // Preusmeri na stranicu za prijavu
    });

    // Početno učitavanje: prikaži sve račune kada se stranica učita (ako je korisnik prijavljen)
    console.log('Initial call to viewAllAccountsBtn.click()'); // Dodatno logovanje
    viewAllAccountsBtn.click();
});
