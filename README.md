# 🚗 Kiraa — Assistant IA de Location Automobile

> **Kiraa** est une application web intelligente d'assistance à la location de véhicules au Maroc. Elle repose sur une architecture **LangGraph.js multi-agents** avec une base de données PostgreSQL et un moteur de calcul 100% déterministe.

---

## 📋 Table des matières

- [Vue d'ensemble](#vue-densemble)
- [Architecture](#architecture)
- [Stack technologique](#stack-technologique)
- [Structure du projet](#structure-du-projet)
- [Règles métier](#règles-métier)
- [Installation et démarrage](#installation-et-démarrage)
- [Variables d'environnement](#variables-denvironnement)
- [Tests E2E](#tests-e2e)
- [Principes clés](#principes-clés)

---

## Vue d'ensemble

Kiraa est un chatbot conversationnel qui permet à un client de :
- **Demander un devis** de location de véhicule (Economy, Compact, SUV, Premium, Utility)
- **Vérifier la disponibilité** d'une catégorie de véhicule
- **Valider son éligibilité** (âge minimum 21 ans, permis minimum 2 ans)
- **Consulter les politiques** de l'agence (caution, assurance, annulation, kilométrage)
- **Uploader des documents** (permis, carte d'identité) via OCR automatique

### Principe fondamental : Zéro-Hallucination

> **Le LLM ne calcule JAMAIS les prix.** Tous les calculs sont effectués par un moteur TypeScript déterministe basé sur la base de données PostgreSQL. Le LLM sert uniquement à comprendre la demande et à rédiger la réponse en français.

---

## Architecture

L'application est construite autour d'un **graphe d'agents LangGraph.js à 7 nœuds** :

```
                      ┌─────────────┐
   Message client ──▶ │  Ingestor   │  Réception & nettoyage du message
                      └──────┬──────┘
                             │
                      ┌──────▼──────┐
                      │  Extractor  │  LLM : extraction d'intention + entités (JSON)
                      └──────┬──────┘
                             │
                      ┌──────▼──────┐
                      │Orchestrator │  Routage conditionnel
                      └──────┬──────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
       ┌──────▼──────┐ ┌────▼─────┐ ┌─────▼──────┐
       │  Validator  │ │ ragNode  │ │  Explainer │  (escalade / hors-sujet)
       └──────┬──────┘ └────┬─────┘ └─────┬──────┘
              │              │             │
    ┌─────────▼────────┐     │             │
    │    Calculator    │     │             │
    │ (Moteur 100%     │     │             │
    │  déterministe)   │     │             │
    └─────────┬────────┘     │             │
              └──────────────┴─────────────▼
                                    ┌──────┴──────┐
                                    │  Explainer  │  LLM : rédaction réponse finale
                                    └──────┬──────┘
                                           │
                                    ┌──────▼──────┐
                                    │  Reporter   │  Fin du cycle
                                    └─────────────┘
```

### Détail des nœuds

| Nœud | Rôle | Technologie |
|------|------|-------------|
| **Ingestor** | Réception du message, support multi-format (texte, image, PDF, JSON) | Tesseract.js (OCR), pdf-parse |
| **Extractor** | Analyse NLP pour extraire l'intention et les entités | LLM Groq (gpt-oss-120b) |
| **Orchestrator** | Routage vers le bon nœud selon l'intention | LangGraph Conditional Edges |
| **Validator** | Vérification des règles d'éligibilité conducteur | Zod, PostgreSQL |
| **Calculator** | Calcul déterministe du prix total | TypeScript pur (zéro LLM) |
| **ragNode** | Recherche sémantique dans les politiques de l'agence | pgvector (PostgreSQL) |
| **Explainer** | Rédaction de la réponse finale en français | LLM Groq |
| **Reporter** | Fin de cycle, journalisation | — |

---

## Stack technologique

### Frontend
| Outil | Version | Rôle |
|-------|---------|------|
| **Next.js** | 16.3.5 | Framework React SSR / API Routes |
| **React** | 19 | Interface utilisateur |
| **Tailwind CSS** | 4 | Styles |
| **lucide-react** | — | Icônes |

### Backend / Agent IA
| Outil | Version | Rôle |
|-------|---------|------|
| **LangGraph.js** | ^1.4 | Orchestration du graphe d'agents |
| **LangChain Core** | ^1.2 | Messages, abstractions LLM |
| **Groq** | ^1.3 | LLM via API Groq (modèle gpt-oss-120b) |

### Base de données
| Outil | Version | Rôle |
|-------|---------|------|
| **PostgreSQL** | 15 + pgvector | Base de données + similarité vectorielle (RAG) |
| **Drizzle ORM** | ^0.45 | ORM TypeScript type-safe |
| **drizzle-kit** | ^0.31 | Migrations de schéma |
| **pg** | ^8 | Driver PostgreSQL natif Node.js |

### Validation & Typage
| Outil | Version | Rôle |
|-------|---------|------|
| **Zod** | ^4 | Validation de données (équivalent Pydantic en TypeScript) |
| **TypeScript** | ^5 | Typage statique sur l'ensemble du projet |

### Traitement de documents
| Outil | Version | Rôle |
|-------|---------|------|
| **Tesseract.js** | ^7 | OCR : extraction de texte depuis images (permis, CNI) |
| **pdf-parse** | ^2 | Extraction de texte depuis fichiers PDF |

### Infrastructure
| Outil | Rôle |
|-------|------|
| **Docker + Docker Compose** | Conteneurisation de PostgreSQL avec pgvector |
| **Dockerfile.postgres** | Image PostgreSQL custom avec pgvector pré-installé |

---

## Structure du projet

```
kiraa_web_app/
├── src/
│   ├── agent/
│   │   ├── graph.ts          # Le graphe LangGraph à 7 nœuds
│   │   └── rag.ts            # Recherche vectorielle (pgvector)
│   ├── app/
│   │   ├── api/
│   │   │   └── chat/
│   │   │       └── route.ts  # API endpoint Next.js (POST /api/chat)
│   │   ├── page.tsx          # Interface chat principale
│   │   └── layout.tsx        # Layout global
│   └── db/
│       ├── index.ts          # Connexion Drizzle vers PostgreSQL
│       ├── schema.ts         # Définition des tables
│       └── queries.ts        # Moteur déterministe : validateDriver(), calculatePrice()
├── scripts/
│   ├── seed_rag.ts           # Peuplement de la base vectorielle
│   └── test_e2e.ts           # Suite de tests E2E (7 scénarios)
├── docker-compose.yml        # PostgreSQL + pgvector
├── Dockerfile.postgres       # Image custom avec pgvector
├── drizzle.config.ts         # Config Drizzle ORM
└── package.json              # Dépendances
```

---

## Règles métier

### Éligibilité conducteur

| Critère | Règle | Conséquence si non respecté |
|---------|-------|----------------------------|
| Âge minimum | **21 ans** | Rejet automatique, **zéro prix affiché** |
| Ancienneté permis | **2 ans minimum** | Rejet automatique, **zéro prix affiché** |
| Jeune conducteur (21-24 ans) sur Premium | Catégorie restreinte | **Escalade humaine obligatoire** |
| Caution > 20 000 MAD | Montant élevé | **Escalade humaine obligatoire** |

### Calcul du prix

**Formule officielle (Cahier des Charges, Page 6) :**

```
Total = (Prix_Base × Jours × Coeff_Saisonnier) + Assurance - Remise + Caution
```

- La **remise est plafonnée à 15%** maximum
- Toute location intra-journalière est facturée au **forfait 1 journée**
- En **septembre** : coefficient saisonnier = **×1.15** (haute saison)

### Tarifs de caution par catégorie

| Catégorie | Caution standard | Jeune conducteur (< 25 ans) |
|-----------|-----------------|-------------------------------|
| Economy | 2 000 MAD | 3 000 MAD (+50%) |
| Compact | 3 000 MAD | 4 500 MAD (+50%) |
| SUV | 5 000 MAD | 7 500 MAD (+50%) |
| Premium | 15 000 MAD | 22 500 MAD → escalade humaine |
| Utility | 7 000 MAD | 10 500 MAD (+50%) |

### Options d'assurance

| Option | Tarif |
|--------|-------|
| Assurance de base | **Incluse gratuitement (0 MAD)** |
| Assurance Tous Risques | 80 MAD / jour |
| Rachat de Franchise | 500 MAD (forfait unique) |

---

## Installation et démarrage

### Prérequis
- Node.js ≥ 18
- Docker Desktop
- Une clé API Groq (gratuite sur [console.groq.com](https://console.groq.com))

### 1. Installer les dépendances

```bash
cd kiraa_web_app
npm install
```

### 2. Configurer les variables d'environnement

```bash
# Créer le fichier .env.local avec les valeurs ci-dessous
```

### 3. Démarrer la base de données

```bash
docker-compose up -d
```

### 4. Appliquer le schéma et remplir la base

```bash
npx drizzle-kit push
npx tsx scripts/seed_rag.ts
```

### 5. Lancer l'application

```bash
npm run dev
# → http://localhost:3000
```

---

## Variables d'environnement

Fichier `.env.local` :

```env
GROQ_API_KEY=gsk_votre_cle_api_groq
DATABASE_URL=postgresql://kiraa_user:kiraa_password@localhost:5432/kiraa_db
```

---

## Tests E2E

```bash
npm test
```

| # | Scénario | Résultat attendu |
|---|----------|-----------------|
| 1 | Conducteur < 21 ans | Rejet + zéro prix |
| 2 | Permis < 2 ans | Rejet + zéro prix |
| 3 | Conducteur 23 ans valide | Calcul avec caution +50% |
| 4 | Remise > 15% | Plafonnée à 15% |
| 5 | Location intra-journalière (17h→23h) | Facturé 1 jour forfait |
| 6 | Coefficient saisonnier septembre | Prix × 1.15 |
| 7 | Assurance Tous Risques 3 jours | +240 MAD (80 × 3) |

**Résultat : 7/7 tests passent ✅**

---

## Principes clés

### Zéro-Hallucination
Le LLM n'a **aucun accès** aux formules de calcul. Il reçoit uniquement le résultat final calculé par `calculatePrice()` et doit le restituer tel quel.

### Séparation des responsabilités
- **LLM** → Compréhension du langage naturel + rédaction en français
- **TypeScript** → Toute la logique métier (validation, calcul, routage)
- **PostgreSQL** → Source unique de vérité pour les prix et la disponibilité

### RAG (Retrieval-Augmented Generation)
Les politiques de l'agence sont stockées dans PostgreSQL avec l'extension **pgvector**. Quand un client pose une question sur les règles, le système recherche les paragraphes les plus pertinents et les injecte dans le contexte du LLM.

---

## Difficultés rencontrées

| Problème | Solution apportée |
|----------|------------------|
| pgvector non disponible sur Docker standard | Création d'un `Dockerfile.postgres` custom |
| LLM qui inventait des prix | Directives `ZÉRO-HALLUCINATION` dans les `SystemMessage` |
| Conducteur inéligible recevant un prix | `routeAfterValidation` : court-circuit du `calculatorNode` |
| Location horaire facturée à l'heure | Règle explicite Extractor + Explainer : toute location = minimum 1 jour |
| Remises non plafonnées | `Math.min(discountPercent, 15)` dans `calculatePrice()` |

---

*Projet réalisé dans le cadre du Cahier des Charges Kiraa (version JavaScript/TypeScript) — Agence de location automobile au Maroc.*
# kiraa
