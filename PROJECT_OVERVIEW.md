# Shadow Pulsar: WhatsApp-First Tiendita Management

Shadow Pulsar is an inventory and sales management ecosystem designed specifically for small merchants ("Tienditas"). It prioritizes a zero-friction user experience by handling all onboarding and daily operations directly through WhatsApp, paired with a lightweight web dashboard for data visualization.

## 🚀 The Vision
Small business owners often find traditional POS systems or complex apps intimidating. Shadow Pulsar removes the barrier by allowing them to manage their entire business using an interface they already know: **WhatsApp**.

---

## 🏗️ Technology Stack
- **Frontend**: React + Vite + TypeScript (Hosted on Vercel).
- **Backend/Database**: Supabase (PostgreSQL).
- **Integrations**: Meta WhatsApp Cloud API.
- **Infrastructure**: Supabase Edge Functions (Deno).

---

## 🛠️ System Architecture

### 1. WhatsApp Onboarding (State Machine)
Users register through a conversational flow:
- **Invite Code**: `TIENDITA2026` (Authorized access).
- **Store Name**: The user provides their business name.
- **Owner Name**: Final step to create the profile.

### 4. Magic Links & Dynamic Dashboard
The system generates a unique **Magic Link** (`https://.../?s=STORE_ID`). 
- **No Login Required**: The dashboard detects the ID in the URL and fetches the specific store data from Supabase.
- **Dynamic Views**: One single deployment on Vercel serves thousands of customized tienditas based on the URL parameter.

### 3. Command Parser
The WhatsApp bot processes natural language/shortcuts for daily tasks:
- Inventory updates.
- Sales recording.
- "Fiado" (Credit) tracking.

---

## ✅ What We Have Accomplished
- [x] **Permanent Connectivity**: Migrated from temporary tokens to a Meta Permanent System User Token.
- [x] **Onboarding Flow**: Implemented a robust 3-step state machine in Supabase Edge Functions.
- [x] **Database Schema**: Established `profiles`, `stores`, and `registration_states` tables with optimized constraints.
- [x] **Dynamic Context**: Updated `StoreContext.tsx` to handle `?s=` parameters, enabling the "Magic Link" feature.
- [x] **Webhook Reliability**: Fixed phone number parsing and Meta ID discrepancies.

---

## 📂 Project Structure & Documentation

- **`/supabase/functions/whatsapp-webhook/index.ts`**: The "brain" of the bot. Handles all messaging logic.
- **`/src/context/StoreContext.tsx`**: Manages the application state and magic link loading.
- **`supabase_schema.sql`**: The source of truth for the database structure.
- **`setup-onboarding.mjs`**: Utility script to initialize the registration system.

---

## 🔮 Next Steps
- [ ] Refine the command parser for complex inventory requests.
- [ ] Implement automated weekly sales reports sent via WhatsApp.
- [ ] Add image support for product registration via WhatsApp photos.

> [!TIP]
> **Don't Push Code for New Stores**: Remember, new stores are created in the database. No new deployment is needed when a new user registers their tiendita via WhatsApp.
