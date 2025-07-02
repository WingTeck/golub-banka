package main

import (
	"encoding/json"
	"fmt"
	"html/template"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid" // Za generisanje UUID-a za sesije
	"golang.org/x/crypto/bcrypt" // Za hešovanje lozinki
)

// PigeonAccount predstavlja bankovni račun jednog goluba.
type PigeonAccount struct {
	ID        string  `json:"id"`
	CardNumber string `json:"cardNumber"` // Novi broj kartice
	Name      string  `json:"name"`
	Balance   float64 `json:"balance"` // Korišćenje float64 za stanje žita
	OwnerID   string  `json:"ownerId"` // ID korisnika koji poseduje ovaj račun
}

// User predstavlja korisnika aplikacije (ne goluba).
type User struct {
	Username string `json:"username"`
	PasswordHash []byte `json:"-"` // Lozinka hešovana, ne šalje se u JSON-u
	UserID   string `json:"userId"`
}

// Session predstavlja aktivnu korisničku sesiju.
type Session struct {
	UserID    string
	ExpiresAt time.Time
}

// Globalne memorijske prodavnice. U pravoj aplikaciji, ovo bi bila baza podataka.
var (
	accounts     = make(map[string]PigeonAccount) // Ključ: ID računa
	accountsByCard = make(map[string]string)      // Ključ: Broj kartice, Vrednost: ID računa
	accountsLock sync.RWMutex                     // Mutex za zaštitu konkurentnog pristupa mapi računa

	users        = make(map[string]User)         // Ključ: Korisničko ime
	usersLock    sync.RWMutex                    // Mutex za zaštitu konkurentnog pristupa mapi korisnika

	sessions     = make(map[string]Session)      // Ključ: Token sesije, Vrednost: Sesija
	sessionsLock sync.RWMutex                    // Mutex za zaštitu konkurentnog pristupa mapi sesija
	nextAccountID int = 1
	nextUserID    int = 1
)

// API Zahtevi/Odgovori Strukture
type CreateAccountRequest struct {
	Name string `json:"name"`
}

type TransactionRequest struct {
	ID         string  `json:"id"`
	CardNumber string  `json:"cardNumber"` // Opcioni broj kartice
	Amount     float64 `json:"amount"`
}

type RegisterRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type LoginResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	Token   string `json:"token,omitempty"`
	UserID  string `json:"userId,omitempty"`
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
	if err := json.NewEncoder(w).Encode(data); err != nil {
		log.Printf("Greška pri kodiranju JSON odgovora: %v", err)
		http.Error(w, "Interna greška servera", http.StatusInternalServerError)
	}
}

// authenticateMiddleware proverava da li je korisnik prijavljen.
func authenticateMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := r.Header.Get("Authorization")
		if token == "" {
			log.Println("Authentication failed: Missing Authorization token.") // Dodato logovanje
			sendJSONResponse(w, APIResponse{Success: false, Message: "Nedostaje token autorizacije."}, http.StatusUnauthorized)
			return
		}

		sessionsLock.RLock()
		session, found := sessions[token]
		sessionsLock.RUnlock()

		if !found || session.ExpiresAt.Before(time.Now()) {
			log.Printf("Authentication failed: Invalid or expired session token '%s'.", token) // Dodato logovanje
			sendJSONResponse(w, APIResponse{Success: false, Message: "Nevažeći ili istekao token sesije."}, http.StatusUnauthorized)
			return
		}

		// Dodaj korisnički ID u kontekst zahteva za dalju upotrebu
		r.Header.Set("X-User-ID", session.UserID)
		log.Printf("Authentication successful for UserID: %s (Token: %s)", session.UserID, token) // Dodato logovanje
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

// registerUserHandler obrađuje zahteve za registraciju novog korisnika.
func registerUserHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Metoda nije dozvoljena", http.StatusMethodNotAllowed)
		return
	}

	var req RegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendJSONResponse(w, APIResponse{Success: false, Message: "Nevažeći sadržaj zahteva."}, http.StatusBadRequest)
		return
	}

	if req.Username == "" || req.Password == "" {
		sendJSONResponse(w, APIResponse{Success: false, Message: "Korisničko ime i lozinka ne mogu biti prazni."}, http.StatusBadRequest)
		return
	}

	usersLock.Lock()
	defer usersLock.Unlock()

	if _, exists := users[req.Username]; exists {
		sendJSONResponse(w, APIResponse{Success: false, Message: "Korisničko ime već postoji."}, http.StatusConflict)
		return
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		log.Printf("Greška pri hešovanju lozinke: %v", err)
		sendJSONResponse(w, APIResponse{Success: false, Message: "Greška pri registraciji korisnika."}, http.StatusInternalServerError)
		return
	}

	userID := fmt.Sprintf("USER-%04d", nextUserID)
	nextUserID++

	newUser := User{
		Username:     req.Username,
		PasswordHash: hashedPassword,
		UserID:       userID,
	}
	users[req.Username] = newUser

	log.Printf("Registrovan novi korisnik: %s (ID: %s)", newUser.Username, newUser.UserID)
	sendJSONResponse(w, APIResponse{Success: true, Message: "Korisnik uspešno registrovan!"}, http.StatusCreated)
}

// loginUserHandler obrađuje zahteve za prijavu korisnika.
func loginUserHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Metoda nije dozvoljena", http.StatusMethodNotAllowed)
		return
	}

	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendJSONResponse(w, LoginResponse{Success: false, Message: "Nevažeći sadržaj zahteva."}, http.StatusBadRequest)
		return
	}

	usersLock.RLock()
	user, found := users[req.Username]
	usersLock.RUnlock()

	if !found {
		sendJSONResponse(w, LoginResponse{Success: false, Message: "Nevažeće korisničko ime ili lozinka."}, http.StatusUnauthorized)
		return
	}

	if err := bcrypt.CompareHashAndPassword(user.PasswordHash, []byte(req.Password)); err != nil {
		sendJSONResponse(w, LoginResponse{Success: false, Message: "Nevažeće korisničko ime ili lozinka."}, http.StatusUnauthorized)
		return
	}

	// Generiši token sesije
	sessionToken := uuid.New().String()
	expiresAt := time.Now().Add(24 * time.Hour) // Sesija ističe za 24 sata

	sessionsLock.Lock()
	sessions[sessionToken] = Session{UserID: user.UserID, ExpiresAt: expiresAt}
	sessionsLock.Unlock()

	log.Printf("Korisnik %s (ID: %s) se uspešno prijavio. Token: %s", user.Username, user.UserID, sessionToken)
	sendJSONResponse(w, LoginResponse{Success: true, Message: "Prijava uspešna!", Token: sessionToken, UserID: user.UserID}, http.StatusOK)
}

// createAccountHandler obrađuje zahteve za kreiranje novog računa goluba.
func createAccountHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Metoda nije dozvoljena", http.StatusMethodNotAllowed)
		return
	}

	ownerID := r.Header.Get("X-User-ID") // Dobij ID korisnika iz middleware-a
	log.Printf("createAccountHandler received request for ownerID: %s", ownerID) // Dodato logovanje
	if ownerID == "" {
		sendJSONResponse(w, APIResponse{Success: false, Message: "Nije pronađen ID vlasnika računa."}, http.StatusInternalServerError)
		return
	}

	var req CreateAccountRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendJSONResponse(w, APIResponse{Success: false, Message: "Nevažeći sadržaj zahteva."}, http.StatusBadRequest)
		return
	}

	if req.Name == "" {
		sendJSONResponse(w, APIResponse{Success: false, Message: "Ime goluba ne može biti prazno."}, http.StatusBadRequest)
		return
	}

	accountsLock.Lock()
	defer accountsLock.Unlock()

	accountID := fmt.Sprintf("PIGEON-%04d", nextAccountID)
	cardNumber := fmt.Sprintf("%016d", nextAccountID) // Jednostavan 16-cifreni broj kartice
	nextAccountID++

	newAccount := PigeonAccount{
		ID:         accountID,
		CardNumber: cardNumber,
		Name:       req.Name,
		Balance:    0.0, // Novi računi počinju sa 0 žita
		OwnerID:    ownerID,
	}
	accounts[accountID] = newAccount
	accountsByCard[cardNumber] = accountID // Mapiraj broj kartice na ID računa

	log.Printf("Kreiran novi račun: %s (Broj kartice: %s) za %s, vlasnik: %s", newAccount.ID, newAccount.CardNumber, newAccount.Name, newAccount.OwnerID)
	sendJSONResponse(w, APIResponse{Success: true, Message: "Račun uspešno kreiran!", Data: newAccount}, http.StatusCreated)
}

// getAccountHandler preuzima detalje za određeni račun goluba ili sve račune.
func getAccountHandler(w http.ResponseWriter, r *http.Request) {
	accountsLock.RLock() // Koristi RLock za operacije čitanja
	defer accountsLock.RUnlock()

	ownerID := r.Header.Get("X-User-ID") // Dobij ID korisnika iz middleware-a
	log.Printf("getAccountHandler received request for ownerID: %s", ownerID) // Dodato logovanje

	accountID := r.URL.Query().Get("id")
	cardNumber := r.URL.Query().Get("cardNumber")

	if accountID != "" || cardNumber != "" {
		var account PigeonAccount
		var found bool

		if accountID != "" {
			account, found = accounts[accountID]
		} else { // Pretraga po broju kartice
			if id, ok := accountsByCard[cardNumber]; ok {
				account, found = accounts[id]
			}
		}

		if !found {
			sendJSONResponse(w, APIResponse{Success: false, Message: "Račun nije pronađen."}, http.StatusNotFound)
			return
		}
		// Proveri da li je vlasnik računa trenutni korisnik
		if account.OwnerID != ownerID {
			sendJSONResponse(w, APIResponse{Success: false, Message: "Nemate dozvolu za pristup ovom računu."}, http.StatusForbidden)
			return
		}

		sendJSONResponse(w, APIResponse{Success: true, Message: "Detalji računa preuzeti.", Data: account}, http.StatusOK)
	} else {
		// Ako nema ID-a, vrati sve račune koje poseduje trenutni korisnik
		userAccounts := make([]PigeonAccount, 0)
		for _, acc := range accounts {
			if acc.OwnerID == ownerID { // Ovo je ključni filter
				userAccounts = append(userAccounts, acc)
			}
		}
		log.Printf("getAccountHandler returning %d accounts for ownerID: %s", len(userAccounts), ownerID) // Dodato logovanje
		sendJSONResponse(w, APIResponse{Success: true, Message: "Svi računi preuzeti.", Data: userAccounts}, http.StatusOK)
	}
}

// depositHandler obrađuje zahteve za uplatu žita na račun.
func depositHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Metoda nije dozvoljena", http.StatusMethodNotAllowed)
		return
	}

	ownerID := r.Header.Get("X-User-ID")

	var req TransactionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendJSONResponse(w, APIResponse{Success: false, Message: "Nevažeći sadržaj zahteva."}, http.StatusBadRequest)
		return
	}

	if req.Amount <= 0 {
		sendJSONResponse(w, APIResponse{Success: false, Message: "Iznos uplate mora biti pozitivan."}, http.StatusBadRequest)
		return
	}

	accountsLock.Lock()
	defer accountsLock.Unlock()

	var targetAccount PigeonAccount
	var found bool

	if req.ID != "" {
		targetAccount, found = accounts[req.ID]
	} else if req.CardNumber != "" {
		if id, ok := accountsByCard[req.CardNumber]; ok {
			targetAccount, found = accounts[id]
		}
	} else {
		sendJSONResponse(w, APIResponse{Success: false, Message: "Morate navesti ID računa ili broj kartice."}, http.StatusBadRequest)
		return
	}

	if !found {
		sendJSONResponse(w, APIResponse{Success: false, Message: "Račun nije pronađen."}, http.StatusNotFound)
		return
	}

	// Proveri da li je vlasnik računa trenutni korisnik
	if targetAccount.OwnerID != ownerID {
		sendJSONResponse(w, APIResponse{Success: false, Message: "Nemate dozvolu za pristup ovom računu."}, http.StatusForbidden)
		return
	}

	targetAccount.Balance += req.Amount
	accounts[targetAccount.ID] = targetAccount // Ažuriraj mapu sa novim stanjem

	log.Printf("Uplaćeno %.2f žita na račun %s (Broj kartice: %s). Novo stanje: %.2f", req.Amount, targetAccount.ID, targetAccount.CardNumber, targetAccount.Balance)
	sendJSONResponse(w, APIResponse{Success: true, Message: "Uplata uspešna!", Data: targetAccount}, http.StatusOK)
}

// withdrawHandler obrađuje zahteve za podizanje žita sa računa.
func withdrawHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Metoda nije dozvoljena", http.StatusMethodNotAllowed)
		return
	}

	ownerID := r.Header.Get("X-User-ID")

	var req TransactionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendJSONResponse(w, APIResponse{Success: false, Message: "Nevažeći sadržaj zahteva."}, http.StatusBadRequest)
		return
	}

	if req.Amount <= 0 {
		sendJSONResponse(w, APIResponse{Success: false, Message: "Iznos povlačenja mora biti pozitivan."}, http.StatusBadRequest)
		return
	}

	accountsLock.Lock()
	defer accountsLock.Unlock()

	var targetAccount PigeonAccount
	var found bool

	if req.ID != "" {
		targetAccount, found = accounts[req.ID]
	} else if req.CardNumber != "" {
		if id, ok := accountsByCard[req.CardNumber]; ok {
			targetAccount, found = accounts[id]
		}
	} else {
		sendJSONResponse(w, APIResponse{Success: false, Message: "Morate navesti ID računa ili broj kartice."}, http.StatusBadRequest)
		return
	}

	if !found {
		sendJSONResponse(w, APIResponse{Success: false, Message: "Račun nije pronađen."}, http.StatusNotFound)
		return
	}

	// Proveri da li je vlasnik računa trenutni korisnik
	if targetAccount.OwnerID != ownerID {
		sendJSONResponse(w, APIResponse{Success: false, Message: "Nemate dozvolu za pristup ovom računu."}, http.StatusForbidden)
		return
	}

	if targetAccount.Balance < req.Amount {
		sendJSONResponse(w, APIResponse{Success: false, Message: "Nedovoljno stanje žita."}, http.StatusBadRequest)
		return
	}

	targetAccount.Balance -= req.Amount
	accounts[targetAccount.ID] = targetAccount // Ažuriraj mapu sa novim stanjem

	log.Printf("Podignuto %.2f žita sa računa %s (Broj kartice: %s). Novo stanje: %.2f", req.Amount, targetAccount.ID, targetAccount.CardNumber, targetAccount.Balance)
	sendJSONResponse(w, APIResponse{Success: true, Message: "Podizanje uspešno!", Data: targetAccount}, http.StatusOK)
}

func main() {
	// Inicijalizuj neke test korisnike (u pravoj aplikaciji, ovo bi bilo iz baze)
	hashedPassword, _ := bcrypt.GenerateFromPassword([]byte("testpass"), bcrypt.DefaultCost)
	users["testuser"] = User{Username: "testuser", PasswordHash: hashedPassword, UserID: "USER-0001"}
	nextUserID = 2 // Podesi sledeći ID korisnika

	// Služi statičke datoteke (HTML, CSS, JS) iz "static" direktorijuma
	http.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.Dir("static"))))

	// Služi glavnu index.html datoteku (za prijavljene korisnike)
	http.HandleFunc("/", serveIndex)
	// Služi login.html datoteku (za prijavu/registraciju)
	http.HandleFunc("/login", serveLogin)

	// API Endpoints bez autentifikacije
	http.HandleFunc("/api/register", registerUserHandler)
	http.HandleFunc("/api/login", loginUserHandler)

	// API Endpoints koji zahtevaju autentifikaciju
	http.HandleFunc("/api/create-account", authenticateMiddleware(createAccountHandler))
	http.HandleFunc("/api/accounts", authenticateMiddleware(getAccountHandler))
	http.HandleFunc("/api/deposit", authenticateMiddleware(depositHandler))
	http.HandleFunc("/api/withdraw", authenticateMiddleware(withdrawHandler))

	port := ":8080"
	log.Printf("Golub Banka server se pokreće na portu %s", port)
	log.Fatal(http.ListenAndServe(port, nil))
}


