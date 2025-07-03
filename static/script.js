document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('golubBankaToken');
    const pigeonID = localStorage.getItem('golubBankaPigeonID');
    const pigeonUsername = localStorage.getItem('golubBankaPigeonUsername');

    console.log('DOMContentLoaded fired. Token:', token ? 'Present' : 'Missing', 'PigeonID:', pigeonID ? 'Present' : 'Missing', 'PigeonUsername:', pigeonUsername ? 'Present' : 'Missing');

    // Provera da li je golub prijavljen - AKO NIJE, PREUSMERI NA LOGIN
    if (!token || !pigeonID || !pigeonUsername) {
        console.log('Pigeon not authenticated, redirecting to /login');
        window.location.href = '/login'; // Preusmeri na stranicu za prijavu ako nije prijavljen
        return; // Prekini izvršavanje skripte
    }

    // Dobij DOM elemente
    const pigeonUsernameDisplay = document.getElementById('pigeonUsernameDisplay');
    const pigeonIdDisplay = document.getElementById('pigeonIdDisplay');
    const pigeonCardNumberDisplay = document.getElementById('pigeonCardNumberDisplay');
    const pigeonBalanceDisplay = document.getElementById('pigeonBalanceDisplay');

    const amountInput = document.getElementById('amount');
    const depositBtn = document.getElementById('depositBtn');
    const withdrawBtn = document.getElementById('withdrawBtn');

    const transferCardNumberInput = document.getElementById('transferCardNumber');
    const transferAmountInput = document.getElementById('transferAmount');
    const transferBtn = document.getElementById('transferBtn');

    const transactionsList = document.getElementById('transactionsList'); // Novi element
    const noTransactionsMessage = document.getElementById('noTransactionsMessage'); // Novi element

    const messageBox = document.getElementById('messageBox');
    const logoutBtn = document.getElementById('logoutBtn');

    // Pomoćna funkcija za prikaz poruka
    function showMessage(message, type) {
        console.log(`Displaying message: [${type}] ${message}`);
        messageBox.textContent = message;
        messageBox.className = `message-box ${type}`;
        messageBox.style.display = 'block';
        setTimeout(() => {
            messageBox.style.display = 'none';
        }, 5000);
    }

    // Pomoćna funkcija za slanje autorizovanih zahteva
    async function authorizedFetch(url, options = {}) {
        options.headers = {
            ...options.headers,
            'Authorization': token // Dodaj token u zaglavlje
        };
        console.log(`Sending authorized fetch to: ${url} with options:`, options);
        try {
            const response = await fetch(url, options);
            console.log(`Received response for ${url}: Status ${response.status}`);
            // Ako je token istekao ili je nevažeći, prikaži poruku i preusmeri na prijavu
            if (response.status === 401 || response.status === 403) {
                showMessage('Vaša sesija je istekla ili nemate dozvolu. Molimo prijavite se ponovo.', 'error');
                localStorage.removeItem('golubBankaToken');
                localStorage.removeItem('golubBankaPigeonID');
                localStorage.removeItem('golubBankaPigeonUsername');
                setTimeout(() => {
                    window.location.href = '/login'; // Sada automatski preusmeravamo
                }, 2000);
                return null;
            }
            return response;
        } catch (error) {
            console.error(`Network error during authorized fetch to ${url}:`, error);
            showMessage('Došlo je do greške pri povezivanju sa serverom. Proverite konzolu za detalje.', 'error');
            return null;
        }
    }

    // Funkcija za učitavanje i prikaz detalja prijavljenog goluba
    async function loadPigeonAccountDetails() {
        console.log('Loading pigeon account details...');
        if (!token || !pigeonID || !pigeonUsername) {
            console.log('loadPigeonAccountDetails: Token or pigeon info missing, setting default display.');
            pigeonUsernameDisplay.textContent = 'Niste prijavljeni';
            pigeonIdDisplay.textContent = 'N/A';
            pigeonCardNumberDisplay.textContent = 'N/A';
            pigeonBalanceDisplay.textContent = '0.00';
            showMessage('Niste prijavljeni. Molimo prijavite se da biste pristupili funkcionalnostima računa.', 'info');
            return;
        }

        try {
            const response = await authorizedFetch('/api/pigeon-account');
            if (!response) {
                console.log('loadPigeonAccountDetails: authorizedFetch returned null (likely auth error or network issue).');
                pigeonUsernameDisplay.textContent = 'Greška pri učitavanju';
                pigeonIdDisplay.textContent = 'N/A';
                pigeonCardNumberDisplay.textContent = 'N/A';
                pigeonBalanceDisplay.textContent = '0.00';
                return;
            }
            const data = await response.json();
            console.log('Pigeon account details API response (raw):', JSON.stringify(data, null, 2));

            if (data.success && data.data) {
                const pigeon = data.data;
                console.log('Successfully received pigeon data.data:', pigeon);
                pigeonUsernameDisplay.textContent = pigeon.username;
                pigeonIdDisplay.textContent = pigeon.id;
                pigeonCardNumberDisplay.textContent = pigeon.cardNumber;
                pigeonBalanceDisplay.textContent = pigeon.balance.toFixed(2);
                showMessage('Detalji računa goluba uspešno učitani.', 'success');
            } else {
                console.warn('Failed to load pigeon account details. Server response (full):', JSON.stringify(data, null, 2));
                showMessage(`Greška pri učitavanju detalja računa: ${data.message || 'Nepoznata greška'}`, 'error');
                pigeonUsernameDisplay.textContent = 'Greška pri učitavanju';
                pigeonIdDisplay.textContent = 'N/A';
                pigeonCardNumberDisplay.textContent = 'N/A';
                pigeonBalanceDisplay.textContent = '0.00';
            }
        } catch (error) {
            console.error('Greška pri učitavanju detalja računa (JavaScript error):', error);
            showMessage('Došlo je do greške pri povezivanju sa serverom prilikom učitavanja detalja računa.', 'error');
            pigeonUsernameDisplay.textContent = 'Greška pri učitavanju';
            pigeonIdDisplay.textContent = 'N/A';
            pigeonCardNumberDisplay.textContent = 'N/A';
            pigeonBalanceDisplay.textContent = '0.00';
        }
        loadTransactionHistory(); // Učitaj transakcije nakon učitavanja detalja računa
    }

    // Funkcija za učitavanje i prikaz istorije transakcija
    async function loadTransactionHistory() {
        console.log('Loading transaction history...');
        transactionsList.innerHTML = ''; // Obriši prethodne transakcije
        noTransactionsMessage.style.display = 'none'; // Sakrij poruku "Nema transakcija" dok se učitava

        if (!token) { // Provera da li je korisnik prijavljen
            noTransactionsMessage.textContent = 'Morate biti prijavljeni da biste videli transakcije.';
            noTransactionsMessage.style.display = 'block';
            return;
        }

        try {
            const response = await authorizedFetch('/api/pigeon-transactions');
            if (!response) {
                console.log('loadTransactionHistory: authorizedFetch returned null.');
                noTransactionsMessage.textContent = 'Greška pri učitavanju transakcija.';
                noTransactionsMessage.style.display = 'block';
                return;
            }
            const data = await response.json();
            console.log('Transaction history API response:', data);

            if (data.success && data.data && data.data.length > 0) {
                data.data.forEach(transaction => {
                    const transactionDiv = document.createElement('div');
                    transactionDiv.className = 'transaction-item';

                    // Formatiranje datuma
                    const date = new Date(transaction.timestamp);
                    const formattedDate = date.toLocaleString('sr-RS', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit'
                    });

                    let amountClass = '';
                    let typeText = transaction.type;
                    if (transaction.type === 'Uplata' || transaction.type === 'TransferPrimljeno') {
                        amountClass = 'deposit';
                    } else if (transaction.type === 'Podizanje' || transaction.type === 'TransferPoslato') {
                        amountClass = 'withdraw';
                    }

                    let counterpartyText = '';
                    if (transaction.counterparty) {
                        counterpartyText = ` (${transaction.counterparty})`;
                    }

                    transactionDiv.innerHTML = `
                        <div>
                            <span class="type ${amountClass}">${typeText}</span> ${counterpartyText}
                            <span class="text-gray-500 text-xs ml-2">${formattedDate}</span>
                        </div>
                        <div class="flex items-center space-x-2">
                            <span class="amount ${amountClass}">${transaction.amount.toFixed(2)} Žita</span>
                            <span class="balance-after text-sm">Stanje: ${transaction.balanceAfter.toFixed(2)}</span>
                        </div>
                    `;
                    transactionsList.appendChild(transactionDiv);
                });
            } else {
                noTransactionsMessage.textContent = 'Nema zabeleženih transakcija.';
                noTransactionsMessage.style.display = 'block';
            }
        } catch (error) {
            console.error('Greška pri učitavanju istorije transakcija (JavaScript error):', error);
            showMessage('Došlo je do greške pri povezivanju sa serverom prilikom učitavanja transakcija.', 'error');
            noTransactionsMessage.textContent = 'Greška pri učitavanju transakcija.';
            noTransactionsMessage.style.display = 'block';
        }
    }


    // Slušači događaja

    // Uplati Žito (na sopstveni račun)
    depositBtn.addEventListener('click', async () => {
        console.log('Deposit button clicked (to own account).');
        const amount = parseFloat(amountInput.value);

        if (isNaN(amount) || amount <= 0) {
            showMessage('Molimo unesite pozitivan iznos žita za uplatu.', 'error');
            return;
        }
        if (!token) {
            showMessage('Morate biti prijavljeni da biste uplatili žito na svoj račun.', 'error');
            return;
        }

        try {
            const response = await authorizedFetch('/api/deposit', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ amount: amount }) // Nema ID-a ili broja kartice jer je na sopstveni račun
            });

            if (!response) return;

            const data = await response.json();
            console.log('Deposit API response:', data);
            if (data.success && data.data) {
                showMessage(`Uplaćeno ${amount.toFixed(2)} žita na vaš račun. Novo stanje: ${data.data.balance.toFixed(2)}`, 'success');
                amountInput.value = ''; // Obriši unos iznosa
                loadPigeonAccountDetails(); // Osveži prikaz stanja i transakcija
            } else {
                showMessage(`Greška pri uplati: ${data.message || 'Nepoznata greška'}`, 'error');
            }
        } catch (error) {
            console.error('Greška pri uplati (JavaScript error):', error);
            showMessage('Došlo je do greške pri povezivanju sa serverom.', 'error');
        }
    });

    // Podigni Žito (sa sopstvenog računa)
    withdrawBtn.addEventListener('click', async () => {
        console.log('Withdraw button clicked (from own account).');
        const amount = parseFloat(amountInput.value);

        if (isNaN(amount) || amount <= 0) {
            showMessage('Molimo unesite pozitivan iznos žita za podizanje.', 'error');
            return;
        }
        if (!token) {
            showMessage('Morate biti prijavljeni da biste podigli žito sa svog računa.', 'error');
            return;
        }

        try {
            const response = await authorizedFetch('/api/withdraw', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ amount: amount }) // Nema ID-a ili broja kartice
            });

            if (!response) return;

            const data = await response.json();
            console.log('Withdraw API response:', data);
            if (data.success && data.data) {
                showMessage(`Podignuto ${amount.toFixed(2)} žita sa vašeg računa. Novo stanje: ${data.data.balance.toFixed(2)}`, 'success');
                amountInput.value = ''; // Obriši unos iznosa
                loadPigeonAccountDetails(); // Osveži prikaz stanja i transakcija
            } else {
                showMessage(`Greška pri podizanju: ${data.message || 'Nepoznata greška'}`, 'error');
            }
        } catch (error) {
            console.error('Greška pri podizanju (JavaScript error):', error);
            showMessage('Došlo je do greške pri povezivanju sa serverom.', 'error');
        }
    });

    // Uplata Drugom Golubu (na broj kartice)
    transferBtn.addEventListener('click', async () => {
        console.log('Transfer button clicked.');
        const cardNumber = transferCardNumberInput.value.trim();
        const amount = parseFloat(transferAmountInput.value);

        if (!cardNumber || isNaN(amount) || amount <= 0) {
            showMessage('Molimo unesite validan broj kartice primaoca i pozitivan iznos žita.', 'error');
            return;
        }
        if (!token) {
            showMessage('Morate biti prijavljeni da biste uplatili žito drugom golubu.', 'error');
            return;
        }

        // Provera da li pokušavate da uplatite na sopstvenu karticu
        if (cardNumber === pigeonCardNumberDisplay.textContent) {
            showMessage('Ne možete uplatiti žito na sopstvenu karticu putem transfera. Koristite dugme "Uplati Žito".', 'info');
            return;
        }

        // Logovanje payload-a pre slanja
        const payload = { cardNumber: cardNumber, amount: amount };
        console.log('Sending transfer payload:', JSON.stringify(payload, null, 2));


        try {
            const response = await authorizedFetch('/api/deposit', { // Koristi se isti deposit endpoint
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (!response) return;

            const data = await response.json();
            console.log('Transfer API response:', data);
            if (data.success && data.data) {
                // Poruka treba da odražava da je stanje pošiljaoca ažurirano
                showMessage(`Uplaćeno ${amount.toFixed(2)} žita na račun goluba ${data.data.username} (${data.data.cardNumber}). Vaše novo stanje: ${data.data.balance.toFixed(2)}`, 'success');
                transferCardNumberInput.value = '';
                transferAmountInput.value = '';
                loadPigeonAccountDetails(); // Osveži prikaz stanja i transakcija pošiljaoca
            } else {
                showMessage(`Greška pri uplati drugom golubu: ${data.message || 'Nepoznata greška'}`, 'error');
            }
        } catch (error) {
            console.error('Greška pri uplati drugom golubu (JavaScript error):', error);
            showMessage('Došlo je do greške pri povezivanju sa serverom.', 'error');
        }
    });


    // Dugme za odjavu
    logoutBtn.addEventListener('click', () => {
        console.log('Logout button clicked.');
        localStorage.removeItem('golubBankaToken');
        localStorage.removeItem('golubBankaPigeonID');
        localStorage.removeItem('golubBankaPigeonUsername');
        window.location.href = '/login'; // Preusmeri na stranicu za prijavu
    });

    // Početno učitavanje: prikaži detalje prijavljenog goluba (ili poruku da nije prijavljen)
    console.log('Initial call to loadPigeonAccountDetails()');
    loadPigeonAccountDetails();
});
