// Pomoćne funkcije za rad sa localStorage
function getBankData() {
    const data = localStorage.getItem('golubBankaData');
    return data ? JSON.parse(data) : { pigeons: {}, nextPigeonID: 1 };
}

function setBankData(data) {
    localStorage.setItem('golubBankaData', JSON.stringify(data));
}

function getLoggedInPigeon() {
    const pigeonUsername = localStorage.getItem('golubBankaPigeonUsername');
    if (!pigeonUsername) return null;
    const bankData = getBankData();
    return bankData.pigeons[pigeonUsername] || null;
}

function updateLoggedInPigeon(updatedPigeon) {
    let bankData = getBankData();
    bankData.pigeons[updatedPigeon.username] = updatedPigeon;
    setBankData(bankData);
    // Ponovo učitaj detalje da bi se osvežio UI
    loadPigeonAccountDetails();
}

// Transaction structure (for client-side consistency)
// This mirrors the Go backend structure for easier transition if needed
// type Transaction struct {
//  Timestamp    time.Time `json:"timestamp"`
//  Type         string    `json:"type"` // "Uplata", "Podizanje", "TransferPoslato", "TransferPrimljeno"
//  Amount       float64   `json:"amount"`
//  Counterparty string    `json:"counterparty,omitempty"` // Korisničko ime/Broj kartice druge strane u transakciji
//  BalanceAfter float64   `json:"balanceAfter"` // Stanje ovog goluba nakon transakcije
// }
function addTransaction(pigeon, type, amount, counterparty, balanceAfter) {
    const newTransaction = {
        timestamp: new Date().toISOString(), // ISO string za lakše parsiranje
        type: type,
        amount: amount,
        counterparty: counterparty,
        balanceAfter: balanceAfter
    };

    // Održavaj samo poslednjih 10 transakcija
    if (pigeon.transactions.length >= 10) {
        pigeon.transactions.shift(); // Ukloni najstariju
    }
    pigeon.transactions.push(newTransaction); // Dodaj novu
}


document.addEventListener('DOMContentLoaded', () => {
    // Provera da li je golub prijavljen - AKO NIJE, PREUSMERI NA LOGIN
    const pigeonUsername = localStorage.getItem('golubBankaPigeonUsername');
    if (!pigeonUsername) {
        console.log('Pigeon not authenticated, redirecting to login.html');
        window.location.href = 'login.html'; // Preusmeri na stranicu za prijavu
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

    const transactionsList = document.getElementById('transactionsList');
    const noTransactionsMessage = document.getElementById('noTransactionsMessage');

    const messageBox = document.getElementById('messageBox');
    const logoutBtn = document.getElementById('logoutBtn');

    // Pomoćna funkcija za prikaz poruka
    function showMessage(message, type) {
        messageBox.textContent = message;
        messageBox.className = `message-box ${type}`;
        messageBox.style.display = 'block';
        setTimeout(() => {
            messageBox.style.display = 'none';
        }, 5000);
    }

    // Funkcija za učitavanje i prikaz detalja prijavljenog goluba
    function loadPigeonAccountDetails() {
        console.log('Loading pigeon account details...');
        const currentPigeon = getLoggedInPigeon();

        if (currentPigeon) {
            pigeonUsernameDisplay.textContent = currentPigeon.username;
            pigeonIdDisplay.textContent = currentPigeon.id;
            pigeonCardNumberDisplay.textContent = currentPigeon.cardNumber;
            pigeonBalanceDisplay.textContent = currentPigeon.balance.toFixed(2);
            showMessage('Detalji računa goluba uspešno učitani.', 'success');
        } else {
            // Ovo bi se trebalo desiti samo ako je localStorage corrupted
            pigeonUsernameDisplay.textContent = 'Greška pri učitavanju';
            pigeonIdDisplay.textContent = 'N/A';
            pigeonCardNumberDisplay.textContent = 'N/A';
            pigeonBalanceDisplay.textContent = '0.00';
            showMessage('Došlo je do greške pri učitavanju detalja računa. Molimo prijavite se ponovo.', 'error');
            localStorage.removeItem('golubBankaPigeonUsername');
            window.location.href = 'login.html';
        }
        loadTransactionHistory(currentPigeon); // Učitaj transakcije nakon učitavanja detalja računa
    }

    // Funkcija za učitavanje i prikaz istorije transakcija
    function loadTransactionHistory(currentPigeon) {
        console.log('Loading transaction history...');
        transactionsList.innerHTML = ''; // Obriši prethodne transakcije
        noTransactionsMessage.style.display = 'none'; // Sakrij poruku "Nema transakcija" dok se učitava

        if (!currentPigeon || !currentPigeon.transactions || currentPigeon.transactions.length === 0) {
            noTransactionsMessage.textContent = 'Nema zabeleženih transakcija.';
            noTransactionsMessage.style.display = 'block';
            return;
        }

        // Prikaz transakcija u obrnutom redosledu (najnovije prve)
        const sortedTransactions = [...currentPigeon.transactions].reverse();

        sortedTransactions.forEach(transaction => {
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
                    <span class="amount ${amountClass}">${transaction.amount.toFixed(2)} Zrna</span>
                    <span class="balance-after text-sm">Stanje: ${transaction.balanceAfter.toFixed(2)}</span>
                </div>
            `;
            transactionsList.appendChild(transactionDiv);
        });
    }


    // Slušači događaja

    // Uplati Zrna (na sopstveni račun)
    depositBtn.addEventListener('click', () => {
        console.log('Deposit button clicked (to own account).');
        const amount = parseFloat(amountInput.value);

        if (isNaN(amount) || amount <= 0) {
            showMessage('Molimo unesite pozitivan iznos Zrna za uplatu.', 'error');
            return;
        }

        let currentPigeon = getLoggedInPigeon();
        if (!currentPigeon) {
            showMessage('Niste prijavljeni.', 'error');
            return;
        }

        currentPigeon.balance += amount;
        addTransaction(currentPigeon, "Uplata", amount, "", currentPigeon.balance);
        updateLoggedInPigeon(currentPigeon); // Ažuriraj localStorage i UI
        showMessage(`Uplaćeno ${amount.toFixed(2)} Zrna na vaš račun. Novo stanje: ${currentPigeon.balance.toFixed(2)}`, 'success');
        amountInput.value = ''; // Obriši unos iznosa
    });

    // Podigni Zrna (sa sopstvenog računa)
    withdrawBtn.addEventListener('click', () => {
        console.log('Withdraw button clicked (from own account).');
        const amount = parseFloat(amountInput.value);

        if (isNaN(amount) || amount <= 0) {
            showMessage('Molimo unesite pozitivan iznos Zrna za podizanje.', 'error');
            return;
        }

        let currentPigeon = getLoggedInPigeon();
        if (!currentPigeon) {
            showMessage('Niste prijavljeni.', 'error');
            return;
        }

        if (currentPigeon.balance < amount) {
            showMessage('Nedovoljno stanje Zrna.', 'error');
            return;
        }

        currentPigeon.balance -= amount;
        addTransaction(currentPigeon, "Podizanje", amount, "", currentPigeon.balance);
        updateLoggedInPigeon(currentPigeon); // Ažuriraj localStorage i UI
        showMessage(`Podignuto ${amount.toFixed(2)} Zrna sa vašeg računa. Novo stanje: ${currentPigeon.balance.toFixed(2)}`, 'success');
        amountInput.value = ''; // Obriši unos iznosa
    });

    // Uplata Drugom Golubu (na broj kartice)
    transferBtn.addEventListener('click', () => {
        console.log('Transfer button clicked.');
        const cardNumber = transferCardNumberInput.value.trim();
        const amount = parseFloat(transferAmountInput.value);

        if (!cardNumber || isNaN(amount) || amount <= 0) {
            showMessage('Molimo unesite validan broj kartice primaoca i pozitivan iznos Zrna.', 'error');
            return;
        }

        let currentPigeon = getLoggedInPigeon();
        if (!currentPigeon) {
            showMessage('Niste prijavljeni.', 'error');
            return;
        }

        // Provera da li pokušavate da uplatite na sopstvenu karticu
        if (cardNumber === currentPigeon.cardNumber) {
            showMessage('Ne možete uplatiti Zrna na sopstvenu karticu putem transfera. Koristite dugme "Uplati Zrna".', 'info');
            return;
        }

        if (currentPigeon.balance < amount) {
            showMessage('Nedovoljno stanje Zrna za transfer.', 'error');
            return;
        }

        let bankData = getBankData();
        let receiverPigeon = null;
        let receiverUsername = null;

        // Pronađi primaoca po broju kartice
        for (const username in bankData.pigeons) {
            if (bankData.pigeons[username].cardNumber === cardNumber) {
                receiverPigeon = bankData.pigeons[username];
                receiverUsername = username;
                break;
            }
        }

        if (!receiverPigeon) {
            showMessage('Golub primalac sa unetim brojem kartice nije pronađen.', 'error');
            return;
        }

        // Izvrši transfer
        currentPigeon.balance -= amount;
        receiverPigeon.balance += amount;

        // Dodaj transakcije
        addTransaction(currentPigeon, "TransferPoslato", amount, receiverPigeon.username, currentPigeon.balance);
        addTransaction(receiverPigeon, "TransferPrimljeno", amount, currentPigeon.username, receiverPigeon.balance);

        // Ažuriraj oba goluba u bankData
        bankData.pigeons[currentPigeon.username] = currentPigeon;
        bankData.pigeons[receiverUsername] = receiverPigeon;
        setBankData(bankData); // Sačuvaj sve promene

        showMessage(`Uplaćeno ${amount.toFixed(2)} Zrna na račun goluba ${receiverPigeon.username} (${receiverPigeon.cardNumber}). Vaše novo stanje: ${currentPigeon.balance.toFixed(2)}`, 'success');
        transferCardNumberInput.value = '';
        transferAmountInput.value = '';
        loadPigeonAccountDetails(); // Osveži prikaz stanja i transakcija pošiljaoca
    });


    // Dugme za odjavu
    logoutBtn.addEventListener('click', () => {
        console.log('Logout button clicked.');
        localStorage.removeItem('golubBankaPigeonID'); // Ukloni samo ID i username prijavljenog goluba
        localStorage.removeItem('golubBankaPigeonUsername');
        window.location.href = 'login.html'; // Preusmeri na stranicu za prijavu
    });

    // Početno učitavanje: prikaži detalje prijavljenog goluba
    console.log('Initial call to loadPigeonAccountDetails()');
    loadPigeonAccountDetails();
});
