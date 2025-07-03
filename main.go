package main

import (
	"encoding/json"
	"fmt"
	"html/template"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

// Transaction predstavlja jednu bankarsku transakciju.
type Transaction struct {
	Timestamp    time.Time `json:"timestamp"`
	Type         string    `json:"type"` // "Uplata", "Podizanje", "TransferPoslato", "TransferPrimljeno"
	Amount       float64   `json:"amount"`
	Counterparty string    `json:"counterparty,omitempty"` // Korisničko ime/Broj kartice druge strane u transakciji
	BalanceAfter float64   `json:"balanceAfter"` // Stanje ovog goluba nakon transakcije
}

// PigeonUser predstavlja goluba koji je istovremeno i korisnik i ima svoj račun.
type PigeonUser struct {
	ID           string  `json:"id"`
	Username     string  `json:"username"`
	PasswordHash []byte  `json:"-"` // Lozinka hešovana, ne šalje se u JSON-u
	CardNumber   string  `json:"cardNumber"` // Jedinstveni broj kartice za goluba
	Balance      float64 `json:"balance"`    // Stanje žita
	Transactions []Transaction `json:"transactions,omitempty"` // Lista transakcija za ovog goluba
}

// Session predstavlja aktivnu korisničku sesiju za goluba.
type Session struct {
	PigeonUserID string
	ExpiresAt    time.Time
}

// Globalne memorijske prodavnice. U pravoj aplikaciji, ovo bi bila baza podataka.
var (
	pigeonUsers      = make(map[string]PigeonUser) // Ključ: Korisničko ime goluba
	pigeonUsersByID  = make(map[string]string)     // Ključ: ID goluba, Vrednost: Korisničko ime
	pigeonUsersByCard = make(map[string]string)    // Ključ: Broj kartice, Vrednost: Korisničko ime
	pigeonUsersLock  sync.RWMutex                  // Mutex za zaštitu konkurentnog pristupa

	sessions     = make(map[string]Session)      // Ključ: Token sesije, Vrednost: Sesija
	sessionsLock sync.RWMutex                    // Mutex za zaštitu konkurentnog pristupa mapi sesija
	nextPigeonID int = 1
)

// API Zahtevi/Odgovori Strukture
type RegisterPigeonRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type LoginPigeonRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type LoginPigeonResponse struct {
	Success bool        `json:"success"`
	Message string      `json:"message"`
	Token   string      `json:"token,omitempty"`
	Pigeon  *PigeonUser `json:"pigeon,omitempty"` // Vraća detalje prijavljenog goluba
}

type TransactionRequest struct {
	Amount     float64 `json:"amount"`
	CardNumber string  `json:"cardNumber"` // Za uplatu na tuđi račun
}

type APIResponse struct {
	Success bool        `json:"success"`
	Message string      `json:"message"`
	Data    interface{} `json:"data,omitempty"`
}

// sendJSONResponse je pomoćna funkcija za slanje JSON odgovora.
func sendJSONResponse(w http.ResponseWriter, data interface{}, statusCode int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	jsonBytes, err := json.Marshal(data) // Prvo pretvori u bajtove
	if err != nil {
		log.Printf("Greška pri pretvaranju JSON odgovora u bajtove: %v", err)
		http.Error(w, "Interna greška servera", http.StatusInternalServerError)
		return
	}
	// Uklonjeno logovanje JSON stringa ovde, jer je ranije izazivalo SyntaxError na frontendu
	if _, err := w.Write(jsonBytes); err != nil { // Napiši bajtove
		log.Printf("Greška pri pisanju JSON odgovora: %v", err)
		http.Error(w, "Interna greška servera", http.StatusInternalServerError)
	}
}

// authenticatePigeonMiddleware proverava da li je golub prijavljen.
func authenticatePigeonMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := r.Header.Get("Authorization")
		if token == "" {
			log.Println("Authentication failed: Missing Authorization token.")
			sendJSONResponse(w, APIResponse{Success: false, Message: "Nedostaje token autorizacije."}, http.StatusUnauthorized)
			return
		}

		sessionsLock.RLock()
		session, found := sessions[token]
		sessionsLock.RUnlock()

		if !found || session.ExpiresAt.Before(time.Now()) {
			log.Printf("Authentication failed: Invalid or expired session token '%s'.", token)
			sendJSONResponse(w, APIResponse{Success: false, Message: "Nevažeći ili istekao token sesije."}, http.StatusUnauthorized)
			return
		}

		// Dodaj ID prijavljenog goluba u kontekst zahteva za dalju upotrebu
		r.Header.Set("X-Pigeon-ID", session.PigeonUserID)
		log.Printf("Authentication successful for PigeonUser ID: %s (Token: %s)", session.PigeonUserID, token)
		next.ServeHTTP(w, r)
	}
}

// serveIndex služi glavnu HTML datoteku za GUI.
func serveIndex(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	tmpl, err := template.ParseFiles("static/index.html")
	if err != nil {
		http.Error(w, fmt.Sprintf("Greška pri učitavanju šablona: %v", err), http.StatusInternalServerError)
		return
	}
	tmpl.Execute(w, nil)
}

// serveLogin služi HTML datoteku za prijavu.
func serveLogin(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/login" {
		http.NotFound(w, r)
		return
	}
	tmpl, err := template.ParseFiles("static/login.html")
	if err != nil {
		http.Error(w, fmt.Sprintf("Greška pri učitavanju šablona: %v", err), http.StatusInternalServerError)
		return
	}
	tmpl.Execute(w, nil)
}

// registerPigeonHandler obrađuje zahteve za registraciju novog goluba-korisnika.
func registerPigeonHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Metoda nije dozvoljena", http.StatusMethodNotAllowed)
		return
	}

	var req RegisterPigeonRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendJSONResponse(w, APIResponse{Success: false, Message: "Nevažeći sadržaj zahteva."}, http.StatusBadRequest)
		return
	}

	if req.Username == "" || req.Password == "" {
		sendJSONResponse(w, APIResponse{Success: false, Message: "Korisničko ime i lozinka ne mogu biti prazni."}, http.StatusBadRequest)
		return
	}

	pigeonUsersLock.Lock()
	defer pigeonUsersLock.Unlock()

	if _, exists := pigeonUsers[req.Username]; exists {
		sendJSONResponse(w, APIResponse{Success: false, Message: "Korisničko ime goluba već postoji."}, http.StatusConflict)
		return
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		log.Printf("Greška pri hešovanju lozinke: %v", err)
		sendJSONResponse(w, APIResponse{Success: false, Message: "Greška pri registraciji goluba."}, http.StatusInternalServerError)
		return
	}

	pigeonID := fmt.Sprintf("PIGEON-%04d", nextPigeonID)
	cardNumber := fmt.Sprintf("%016d", nextPigeonID) // Jednostavan 16-cifreni broj kartice
	nextPigeonID++

	newPigeon := PigeonUser{
		ID:           pigeonID,
		Username:     req.Username,
		PasswordHash: hashedPassword,
		CardNumber:   cardNumber,
		Balance:      0.0, // Novi golubovi počinju sa 0 žita
		Transactions: []Transaction{}, // Inicijalizuj praznu listu transakcija
	}
	pigeonUsers[req.Username] = newPigeon
	pigeonUsersByID[pigeonID] = req.Username
	pigeonUsersByCard[cardNumber] = req.Username

	log.Printf("Registrovan novi golub-korisnik: %s (ID: %s, Broj kartice: %s)", newPigeon.Username, newPigeon.ID, newPigeon.CardNumber)
	sendJSONResponse(w, APIResponse{Success: true, Message: "Golub-korisnik uspešno registrovan!"}, http.StatusCreated)
}

// loginPigeonHandler obrađuje zahteve za prijavu goluba-korisnika.
func loginPigeonHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Metoda nije dozvoljena", http.StatusMethodNotAllowed)
		return
	}

	var req LoginPigeonRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendJSONResponse(w, LoginPigeonResponse{Success: false, Message: "Nevažeći sadržaj zahteva."}, http.StatusBadRequest)
		return
	}

	pigeonUsersLock.RLock()
	pigeon, found := pigeonUsers[req.Username]
	pigeonUsersLock.RUnlock()

	if !found {
		sendJSONResponse(w, LoginPigeonResponse{Success: false, Message: "Nevažeće korisničko ime goluba ili lozinka."}, http.StatusUnauthorized)
		return
	}

	if err := bcrypt.CompareHashAndPassword(pigeon.PasswordHash, []byte(req.Password)); err != nil {
		sendJSONResponse(w, LoginPigeonResponse{Success: false, Message: "Nevažeće korisničko ime goluba ili lozinka."}, http.StatusUnauthorized)
		return
	}

	// Generiši token sesije
	sessionToken := uuid.New().String()
	expiresAt := time.Now().Add(24 * time.Hour) // Sesija ističe za 24 sata

	sessionsLock.Lock()
	sessions[sessionToken] = Session{PigeonUserID: pigeon.ID, ExpiresAt: expiresAt}
	sessionsLock.Unlock()

	log.Printf("Golub-korisnik %s (ID: %s) se uspešno prijavio. Token: %s", pigeon.Username, pigeon.ID, sessionToken)
	sendJSONResponse(w, LoginPigeonResponse{Success: true, Message: "Prijava uspešna!", Token: sessionToken, Pigeon: &pigeon}, http.StatusOK)
}

// getPigeonAccountHandler preuzima detalje prijavljenog goluba-korisnika.
func getPigeonAccountHandler(w http.ResponseWriter, r *http.Request) {
	pigeonUsersLock.RLock()
	defer pigeonUsersLock.RUnlock()

	pigeonUserID := r.Header.Get("X-Pigeon-ID") // Dobij ID prijavljenog goluba iz middleware-a
	log.Printf("getPigeonAccountHandler received request for PigeonUser ID: %s", pigeonUserID)

	username, found := pigeonUsersByID[pigeonUserID]
	if !found {
		log.Printf("PigeonUser not found for ID: %s", pigeonUserID)
		sendJSONResponse(w, APIResponse{Success: false, Message: "Prijavljeni golub-korisnik nije pronađen."}, http.StatusNotFound)
		return
	}

	pigeon, found := pigeonUsers[username]
	if !found { // Ovo bi trebalo da bude redundantno ako je pigeonUsersByID ispravan
		log.Printf("PigeonUser not found for username: %s (ID: %s)", username, pigeonUserID)
		sendJSONResponse(w, APIResponse{Success: false, Message: "Prijavljeni golub-korisnik nije pronađen."}, http.StatusNotFound)
		return
	}

	sendJSONResponse(w, APIResponse{Success: true, Message: "Detalji računa goluba preuzeti.", Data: pigeon}, http.StatusOK)
}

// addTransaction je pomoćna funkcija za dodavanje transakcije u istoriju goluba.
func addTransaction(pigeon *PigeonUser, transType string, amount float64, counterparty string, balanceAfter float64) {
	newTransaction := Transaction{
		Timestamp:    time.Now(),
		Type:         transType,
		Amount:       amount,
		Counterparty: counterparty,
		BalanceAfter: balanceAfter,
	}
	// Održavaj samo poslednjih 10 transakcija
	if len(pigeon.Transactions) >= 10 {
		pigeon.Transactions = append(pigeon.Transactions[1:], newTransaction) // Ukloni najstariju, dodaj novu
	} else {
		pigeon.Transactions = append(pigeon.Transactions, newTransaction)
	}
}

// depositHandler obrađuje zahteve za uplatu žita.
// Može biti uplata na sopstveni račun (bez cardNumber) ili na tuđi (sa cardNumber).
func depositHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Metoda nije dozvoljena", http.StatusMethodNotAllowed)
		return
	}

	senderPigeonID := r.Header.Get("X-Pigeon-ID") // ID goluba koji vrši uplatu

	var req TransactionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendJSONResponse(w, APIResponse{Success: false, Message: "Nevažeći sadržaj zahteva."}, http.StatusBadRequest)
		return
	}

	if req.Amount <= 0 {
		sendJSONResponse(w, APIResponse{Success: false, Message: "Iznos uplate mora biti pozitivan."}, http.StatusBadRequest)
		return
	}

	pigeonUsersLock.Lock()
	defer pigeonUsersLock.Unlock()

	// Pronađi goluba koji vrši uplatu (pošiljaoca)
	senderUsername, senderFound := pigeonUsersByID[senderPigeonID]
	if !senderFound {
		sendJSONResponse(w, APIResponse{Success: false, Message: "Prijavljeni golub (pošiljalac) nije pronađen."}, http.StatusNotFound)
		return
	}
	senderPigeon := pigeonUsers[senderUsername]

	// Odredi ciljani račun
	var targetPigeon PigeonUser
	var targetUsername string
	var targetFound bool

	if req.CardNumber != "" {
		// Uplata na tuđi račun putem broja kartice
		targetUsername, targetFound = pigeonUsersByCard[req.CardNumber]
		if targetFound {
			targetPigeon = pigeonUsers[targetUsername]
		}
	} else {
		// Uplata na sopstveni račun
		targetUsername = senderUsername
		targetPigeon = senderPigeon
		targetFound = true
	}

	if !targetFound {
		sendJSONResponse(w, APIResponse{Success: false, Message: "Ciljani račun goluba nije pronađen."}, http.StatusNotFound)
		return
	}

	// Proveri da li pošiljalac ima dovoljno žita za transfer (ako je transfer)
	if req.CardNumber != "" && senderPigeon.Balance < req.Amount {
		sendJSONResponse(w, APIResponse{Success: false, Message: "Nedovoljno stanje žita za transfer."}, http.StatusBadRequest)
		return
	}

	// Izvrši transakciju
	if req.CardNumber != "" {
		// Ovo je transfer na tuđi račun
		senderPigeon.Balance -= req.Amount // Oduzmi sa računa pošiljaoca
		targetPigeon.Balance += req.Amount // Dodaj na račun primaoca

		// Dodaj transakciju pošiljaocu
		addTransaction(&senderPigeon, "TransferPoslato", req.Amount, targetPigeon.Username, senderPigeon.Balance)
		// Dodaj transakciju primaocu
		addTransaction(&targetPigeon, "TransferPrimljeno", req.Amount, senderPigeon.Username, targetPigeon.Balance)

		pigeonUsers[senderUsername] = senderPigeon     // Ažuriraj pošiljaoca
		pigeonUsers[targetUsername] = targetPigeon     // Ažuriraj primaoca

		log.Printf("Transferovano %.2f žita sa %s na %s. Stanje pošiljaoca: %.2f, Stanje primaoca: %.2f",
			req.Amount, senderPigeon.Username, targetPigeon.Username, senderPigeon.Balance, targetPigeon.Balance)

		// Vrati ažurirano stanje pošiljaoca
		sendJSONResponse(w, APIResponse{Success: true, Message: "Transfer uspešan!", Data: senderPigeon}, http.StatusOK)

	} else {
		// Ovo je uplata na sopstveni račun (deposit)
		targetPigeon.Balance += req.Amount
		// Dodaj transakciju
		addTransaction(&targetPigeon, "Uplata", req.Amount, "", targetPigeon.Balance)
		pigeonUsers[targetUsername] = targetPigeon // Ažuriraj sopstveni račun

		log.Printf("Uplaćeno %.2f žita na sopstveni račun goluba %s (ID: %s, Broj kartice: %s). Novo stanje: %.2f",
			req.Amount, targetPigeon.Username, targetPigeon.ID, targetPigeon.CardNumber, targetPigeon.Balance)
		sendJSONResponse(w, APIResponse{Success: true, Message: "Uplata uspešna!", Data: targetPigeon}, http.StatusOK)
	}
}

// withdrawHandler obrađuje zahteve za podizanje žita sa sopstvenog računa.
func withdrawHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Metoda nije dozvoljena", http.StatusMethodNotAllowed)
		return
	}

	pigeonUserID := r.Header.Get("X-Pigeon-ID") // ID goluba koji vrši podizanje

	var req TransactionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendJSONResponse(w, APIResponse{Success: false, Message: "Nevažeći sadržaj zahteva."}, http.StatusBadRequest)
		return
	}

	if req.Amount <= 0 {
		sendJSONResponse(w, APIResponse{Success: false, Message: "Iznos povlačenja mora biti pozitivan."}, http.StatusBadRequest)
		return
	}

	pigeonUsersLock.Lock()
	defer pigeonUsersLock.Unlock()

	username, found := pigeonUsersByID[pigeonUserID]
	if !found {
		sendJSONResponse(w, APIResponse{Success: false, Message: "Prijavljeni golub-korisnik nije pronađen."}, http.StatusNotFound)
		return
	}

	pigeon, found := pigeonUsers[username]
	if !found { // Redundantna provera
		sendJSONResponse(w, APIResponse{Success: false, Message: "Prijavljeni golub-korisnik nije pronađen."}, http.StatusNotFound)
		return
	}

	if pigeon.Balance < req.Amount {
		sendJSONResponse(w, APIResponse{Success: false, Message: "Nedovoljno stanje žita."}, http.StatusBadRequest)
		return
	}

	pigeon.Balance -= req.Amount
	// Dodaj transakciju
	addTransaction(&pigeon, "Podizanje", req.Amount, "", pigeon.Balance)
	pigeonUsers[username] = pigeon // Ažuriraj mapu sa novim stanjem

	log.Printf("Podignuto %.2f žita sa računa goluba %s (ID: %s). Novo stanje: %.2f", req.Amount, pigeon.Username, pigeon.ID, pigeon.Balance)
	sendJSONResponse(w, APIResponse{Success: true, Message: "Podizanje uspešno!", Data: pigeon}, http.StatusOK)
}

// getPigeonTransactionsHandler preuzima poslednjih 10 transakcija za prijavljenog goluba.
func getPigeonTransactionsHandler(w http.ResponseWriter, r *http.Request) {
	pigeonUsersLock.RLock()
	defer pigeonUsersLock.RUnlock()

	pigeonUserID := r.Header.Get("X-Pigeon-ID")
	log.Printf("getPigeonTransactionsHandler received request for PigeonUser ID: %s", pigeonUserID) // Dodato logovanje

	username, found := pigeonUsersByID[pigeonUserID]
	if !found {
		log.Printf("getPigeonTransactionsHandler: PigeonUser not found for ID: %s", pigeonUserID) // Dodato logovanje
		sendJSONResponse(w, APIResponse{Success: false, Message: "Prijavljeni golub-korisnik nije pronađen."}, http.StatusNotFound)
		return
	}

	pigeon, found := pigeonUsers[username]
	if !found {
		log.Printf("getPigeonTransactionsHandler: PigeonUser not found for username: %s (ID: %s)", username, pigeonUserID) // Dodato logovanje
		sendJSONResponse(w, APIResponse{Success: false, Message: "Prijavljeni golub-korisnik nije pronađen."}, http.StatusNotFound)
		return
	}

	// Važno: Vrati transakcije unutar standardnog APIResponse formata
	sendJSONResponse(w, APIResponse{Success: true, Message: "Transakcije preuzete.", Data: pigeon.Transactions}, http.StatusOK)
}

func main() {
	// Služi statičke datoteke (HTML, CSS, JS) iz "static" direktorijuma
	http.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.Dir("static"))))

	// Služi glavnu index.html datoteku (za prijavljene golubove-korisnike)
	http.HandleFunc("/", serveIndex)
	// Služi login.html datoteku (za prijavu/registraciju golubova-korisnika)
	http.HandleFunc("/login", serveLogin)

	// API Endpoints bez autentifikacije
	http.HandleFunc("/api/register-pigeon", registerPigeonHandler)
	http.HandleFunc("/api/login-pigeon", loginPigeonHandler)

	// API Endpoints koji zahtevaju autentifikaciju goluba
	http.HandleFunc("/api/pigeon-account", authenticatePigeonMiddleware(getPigeonAccountHandler))
	http.HandleFunc("/api/deposit", authenticatePigeonMiddleware(depositHandler)) // Deposit i transfer
	http.HandleFunc("/api/withdraw", authenticatePigeonMiddleware(withdrawHandler))
	http.HandleFunc("/api/pigeon-transactions", authenticatePigeonMiddleware(getPigeonTransactionsHandler)) // Novi endpoint

	port := ":8080"
	log.Printf("Golub Banka server se pokreće na portu %s", port)
	log.Fatal(http.ListenAndServe(port, nil))
}

