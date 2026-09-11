# MusicTheory SaaS Platform Roadmap

**Last Updated:** 2026-09-10

This document tracks the progress of transforming MusicTheory from a standalone learning tool into a B2B SaaS platform for music education.

> **Scope note.** The numbered phases below are the *platform* — accounts, teachers,
> students, lessons, payments. A second line of work has been running alongside them on
> the *tools* those lessons will be taught with: the sheet music composer, audio
> transcription, the circle of fifths, and the progression composer. That work is
> tracked in [Music Tooling](#music-tooling) rather than in the phase table, because it
> does not block any phase and no phase blocks it.

---

## Overview

The platform enables:
- **Teachers** to manage students, create curricula, conduct live lessons with synchronized tools
- **Students** to learn with gamification, track progress, and practice with interactive tools
- **Marketplace** for teachers to publish and monetize self-paced courses

---

## Phase Status Summary

| Phase | Name | Status | Progress |
|-------|------|--------|----------|
| 1 | Foundation | **COMPLETE** | 14/14 tasks |
| 2 | Teacher-Student Core | Planned | 0/? tasks |
| 3 | Live Sessions | Planned | 0/? tasks |
| 4 | Scheduling & Engagement | Planned | 0/? tasks |
| 5 | Gamification | Planned | 0/? tasks |
| 6 | Payments & Licensing | Planned | 0/? tasks |
| 7 | Marketplace | Planned | 0/? tasks |
| 8 | PWA & Polish | Planned | 0/? tasks |

---

## Phase 1: Foundation (COMPLETE)

### Completed Tasks

- [x] **Task 1**: Update project structure and dependencies
  - Added NuGet packages: EF Core 9, Identity, JWT Bearer, OAuth providers

- [x] **Task 2**: Create domain models
  - `User` (extends IdentityUser)
  - `TeacherProfile`
  - `StudentProfile`
  - `Enrollment`
  - `Invitation`
  - `RefreshToken`
  - Enums: `UserRole`, `EnrollmentStatus`, `ProgressionMode`

- [x] **Task 3**: Create database context
  - `MusicTheoryDbContext` with Identity integration
  - Configured relationships and indexes

- [x] **Task 4**: Create DTOs for API
  - Auth: `RegisterRequest`, `LoginRequest`, `AuthResponse`, `RefreshTokenRequest`
  - User: `UserDto`, `TeacherProfileDto`, `StudentProfileDto`, `UpdateUserRequest`

- [x] **Task 5**: Create JWT and Auth services
  - `IJwtService` / `JwtService` - Token generation and validation
  - `IAuthService` / `AuthService` - Registration, login, refresh, logout

- [x] **Task 6**: Configure application startup
  - Identity with custom password policies
  - JWT Bearer authentication
  - CORS for Angular client
  - Swagger with JWT authorization

- [x] **Task 7**: Create Auth controller
  - `POST /api/auth/register`
  - `POST /api/auth/login`
  - `POST /api/auth/refresh`
  - `POST /api/auth/logout`

- [x] **Task 8**: Create Users controller
  - `GET /api/users/me`
  - `PUT /api/users/me`

- [x] **Task 9**: Create database migration
  - Initial migration with all Identity and custom tables

- [x] **Task 10**: Create Angular auth models
  - `auth.model.ts` - Request/response types and UserRole enum
  - `user.model.ts` - UserDto and profile types

- [x] **Task 11**: Create Angular auth service
  - `AuthService` with BehaviorSubject state management
  - Token storage in localStorage
  - Auto-refresh on app load

- [x] **Task 12**: Create Angular auth guards
  - `authGuard` - Route protection for authenticated users
  - `teacherGuard` - Route protection for teachers
  - `studentGuard` - Route protection for students

- [x] **Task 13**: Update Angular app configuration
  - Functional HTTP interceptor for JWT injection
  - Token refresh on 401 responses
  - Environment configuration

- [x] **Task 14**: Test the API
  - SQL Server running in Docker on Ubuntu server (192.168.1.36)
  - Database migrations applied successfully
  - Registration, login, and authenticated endpoints verified

### Files Created

```
server/MusicTheory.API/
├── Data/
│   └── MusicTheoryDbContext.cs
├── Models/
│   ├── Entities/
│   │   ├── User.cs
│   │   ├── TeacherProfile.cs
│   │   ├── StudentProfile.cs
│   │   ├── Enrollment.cs
│   │   ├── Invitation.cs
│   │   └── RefreshToken.cs
│   ├── Enums/
│   │   ├── UserRole.cs
│   │   ├── EnrollmentStatus.cs
│   │   └── ProgressionMode.cs
│   └── DTOs/
│       ├── Auth/
│       │   ├── RegisterRequest.cs
│       │   ├── LoginRequest.cs
│       │   ├── AuthResponse.cs
│       │   └── RefreshTokenRequest.cs
│       └── User/
│           ├── UserDto.cs
│           └── UpdateUserRequest.cs
├── Services/
│   ├── IJwtService.cs
│   ├── JwtService.cs
│   ├── IAuthService.cs
│   ├── AuthService.cs
│   ├── IUserService.cs
│   └── UserService.cs
├── Controllers/
│   ├── AuthController.cs
│   └── UsersController.cs
├── Migrations/
│   └── [InitialCreate migration files]
├── appsettings.json
├── appsettings.Development.json
└── Startup.cs

client/src/
├── app/
│   ├── models/
│   │   ├── auth.model.ts
│   │   └── user.model.ts
│   ├── services/
│   │   └── auth.service.ts
│   ├── interceptors/
│   │   └── auth.interceptor.ts
│   └── guards/
│       ├── auth.guard.ts
│       └── role.guard.ts
└── environments/
    ├── environment.ts
    └── environment.prod.ts
```

---

## Phase 2: Teacher-Student Core (MVP) - NEXT

### Planned Features
- Teacher dashboard with student management
- Student dashboard with teacher/course view
- Invitation system (generate codes, accept invitations)
- Course and lesson CRUD
- Content block system (text, video, exercises, GP files)
- Basic progress tracking

### Key Endpoints to Implement
```
/api/teachers
  GET /me - Teacher dashboard data
  GET /students - List enrolled students
  POST /invitations - Create invitation

/api/students
  GET /me - Student dashboard data
  GET /teachers - List enrolled teachers
  POST /invitations/{code}/accept - Accept invitation

/api/courses
  GET / - List courses
  POST / - Create course
  GET /{id} - Get course details
  PUT /{id} - Update course
  DELETE /{id} - Delete course

/api/lessons
  GET /course/{courseId} - List lessons in course
  POST / - Create lesson
  GET /{id} - Get lesson with content blocks
  PUT /{id} - Update lesson
```

---

## Phase 3: Live Sessions

### Planned Features
- Azure Communication Services video integration
- SignalR real-time synchronization
- Live session UI with spotlight system
- Synchronized tool state (fretboard, keyboard, GP playback)
- Session recording and playback
- Teacher markers/annotations

---

## Phase 4: Scheduling & Engagement

### Planned Features
- Teacher availability management
- Student booking flow
- Calendar views and external sync (.ics)
- Notification system (email, push, in-app)
- Weekly engagement newsletter

---

## Phase 5: Gamification

### Planned Features
- XP points for activities
- Level progression system
- Streak tracking
- Achievement badges
- Teacher-created custom achievements
- Progress visualizations

---

## Phase 6: Payments & Licensing

### Planned Features
- Stripe subscription integration
- Usage-based licensing for teachers
- Invoice generation
- License verification middleware

---

## Phase 7: Marketplace

### Planned Features
- Course publishing workflow
- Public course browsing and search
- Stripe Connect for teacher payouts
- Purchase flow with 7-day refund
- Ratings and reviews
- Royalty dashboard for teachers

---

## Phase 8: PWA & Polish

### Planned Features
- Service worker for offline support
- IndexedDB caching for lessons
- Background sync for progress
- Performance optimization
- Security audit
- Production deployment

---

## Infrastructure

### Current Setup (Development)
- **Database**: SQL Server 2022 in Docker on Ubuntu server (192.168.1.36)
- **API**: ASP.NET Core 10 running locally
- **Frontend**: Angular 21 on localhost:4200

### Planned Production (Azure)
- Azure SQL Database
- Azure App Service (API)
- Azure Static Web Apps (Angular)
- Azure Communication Services (video/email)
- Azure Cache for Redis (real-time sync)
- Azure Blob Storage (media/GP files)
- Azure SignalR Service
- Stripe (payments)

---

## Music Tooling

Built alongside the platform phases, and shipped. Each has a design document that
records the decisions and — where implementation disproved one — the correction.

| Tool | Route | State |
|---|---|---|
| Sheet music composer | `/composer` | Shipped. Multi-track notation and tab, MIDI and `.gp` export |
| Audio transcription | `/transcribe` | Shipped. Basic Pitch detection, beat tracking, correctable review |
| Circle of fifths | drawer | Shipped. Sets the key app-wide |
| Progression composer | `/progression` | M1, M2 and M3 shipped. M4 not started |

**Progression composer milestones:**

| | | |
|---|---|---|
| M1 | Shipped | Model, service, palette, strip, block chords, Tone loop |
| M2 | Shipped | Piano roll, per-aspect edit protection, borrowed chords and secondary dominants, loop-boundary rescheduling, notation projection |
| M3 | Shipped | The recogniser: a hand-edited slot reading its identity back, `literal` degradation and a way out of it, the alternates chip; suspensions sounded and each extension alterable; names composed from the chord; every note spelled by its degree's letter |
| M4 | Not started | Generated track in the composer, Flatten, MIDI and `.gp` export |

Three things are recorded as known limitations rather than bugs, all in the design doc:
`quantizeBar` is onset-driven and has no note-off, so a staccato roll engraves legato;
`BeatDoc.dynamics: null` is documented as "inherit" but nothing implements it, which
affects transcription as well as the progression preview; and the recogniser takes the
first reading that consumes every note, so two chords the palette can build in three
clicks lose their numeral to a reading that has no name and degrade to `literal`.

---

## Design Documents

| Document | Path | Status |
|----------|------|--------|
| Platform Design | [plans/2026-01-20-saas-platform-design.md](plans/2026-01-20-saas-platform-design.md) | Complete |
| Phase 1 Plan | [plans/2026-01-20-phase1-foundation-plan.md](plans/2026-01-20-phase1-foundation-plan.md) | Complete |
| Azure Pricing | [azure-saas-pricing-estimate.md](azure-saas-pricing-estimate.md) | Draft |
| Sheet Music Composer | [plans/2026-09-04-sheet-music-composer-design.md](plans/2026-09-04-sheet-music-composer-design.md) | Implemented |
| Audio Transcription | [plans/2026-09-05-audio-transcription-design.md](plans/2026-09-05-audio-transcription-design.md) | Implemented, M1-M3 |
| Two-Tier Transcription | [plans/2026-09-07-two-tier-transcription-design.md](plans/2026-09-07-two-tier-transcription-design.md) | Implemented |
| Circle of Fifths | [plans/2026-09-07-circle-of-fifths-design.md](plans/2026-09-07-circle-of-fifths-design.md) | Implemented |
| Progression Composer | [plans/2026-09-08-progression-composer-design.md](plans/2026-09-08-progression-composer-design.md) | M1-M3 implemented |

Implementation plans, one per milestone, sit beside each design in `plans/`. The
transcription investigations that produced *negative* results are kept too — the onset
posteriorgram, stem separation, and the neural tempo estimator — because knowing what
was tried and did not work is worth as much as the designs that shipped.

---

## Quick Start (Development)

### Prerequisites
- Node.js 20+
- .NET 10 SDK
- Docker (for SQL Server) OR SQL Server LocalDB

### Start Database (Docker)
```bash
# On server with Docker
docker run -e "ACCEPT_EULA=Y" -e "MSSQL_SA_PASSWORD=YourPassword" \
  -p 1433:1433 --name sqlserver -d mcr.microsoft.com/mssql/server:2022-latest
```

### Start API
```bash
cd server/MusicTheory.API
dotnet ef database update  # Apply migrations
dotnet run --urls "https://localhost:5001"
```

### Start Angular
```bash
cd client
npm install
npm start  # Opens on http://localhost:4200
```

---

## Contributing

See [CLA.md](../CLA.md), and the Contributing section of the
[README](../README.md#contributing), for contribution guidelines.
