# MusicTheory SaaS Platform Design

**Date:** 2026-01-20
**Status:** Draft - Pending Implementation Planning

---

## Executive Summary

Transform MusicTheory from a standalone learning tool into a B2B-first music education SaaS platform that enables teachers to deliver personalized instruction using interactive tools, with a marketplace for self-paced courses.

### Core Value Propositions

| Audience | Value |
|----------|-------|
| **Teachers** | Professional teaching studio with interactive tools, student management, curriculum builder, and optional revenue from published courses |
| **Live Students** | Personalized instruction with gamified progress tracking, practice tools, and recorded sessions for review |
| **Course Students** | Self-paced learning from published curricula with the same interactive tools |
| **Platform** | Revenue from teacher licensing (B2B) and course sales commissions (B2C marketplace) |

### Key Differentiator

Unlike video-only platforms (Zoom) or static courses (Udemy), this combines real-time synchronized collaboration with professional music education tools.

---

## Business Model

### Revenue Streams

| Mode | Who Pays | Who Gets Paid |
|------|----------|---------------|
| **Live Teaching (B2B)** | Teacher pays platform (usage-based license) | Platform |
| **Published Courses (B2C)** | Student pays platform | Platform + Teacher (royalties) |

### Teacher Operating Modes

A teacher can operate in both modes simultaneously:
- Teach live students using the platform tools (they pay us)
- Publish self-paced courses (they earn from us)

### Pricing (To Be Determined)

Pricing structure deferred until costs are understood:
- Hosting costs
- Video conferencing API costs (Azure Communication Services)
- Development team costs
- Potential government grants

Key consideration: Usage-based component to prevent abuse (e.g., hourly tracking for educators).

---

## User Roles & Relationships

### User Types

| Role | Description | Pays | Earns |
|------|-------------|------|-------|
| **Teacher** | Creates content, teaches live, manages students | Platform license | Royalties from published courses |
| **Live Student** | Enrolled with a specific teacher | Nothing directly | — |
| **Course Student** | Purchases self-paced courses | Course fees | — |

### Relationship Models

```
LIVE TEACHING (B2B)
───────────────────
Teacher ──pays platform──► Platform
   │
   ├── Invite-only students (existing clients)
   └── Open enrollment students (new via platform)

Teacher controls: curriculum, pacing, access


MARKETPLACE (B2C)
─────────────────
Teacher ──publishes course──► Platform Marketplace

Course Student ──pays──► Platform ──royalties──► Teacher

Student works independently through published content
```

### Teacher-Student Modes

- **Invite-only**: Teachers generate invite codes for existing students
- **Open enrollment**: Teachers have public profiles, students can request to join
- **Both modes available**: Teacher chooses per their preference

---

## Lesson & Content Architecture

### Lesson Structure

Lessons are modular containers that can hold multiple content types:

```
LESSON
├── Metadata: title, description, difficulty, duration
├── Objectives: what student should learn
├── Prerequisites: required prior lessons (optional)
├── CONTENT BLOCKS (mix and match):
│   ├── Text (markdown)
│   ├── Video (embedded)
│   ├── Image
│   ├── Interactive Exercise
│   ├── GP File (song)
│   └── Quiz
└── Completion Criteria: quiz score, time practiced, etc.
```

### Lesson Types Supported

1. **Interactive exercises** - Scale/chord practice with existing tools
2. **Guided content packages** - Text, video, images + exercises
3. **Curated sequences** - Ordered arrangement of existing content
4. **Song-based** - GP files with annotations and practice goals

### Curriculum Hierarchy

```
Course
  └── Module (e.g., "Major Scale Fundamentals")
        └── Lesson (e.g., "C Major Scale - Position 1")
              └── Content Blocks
```

### Interactive Exercise Types

- Scale practice (specific scale, tempo, note accuracy)
- Chord practice (shapes, transitions, strumming patterns)
- Fretboard navigation (find notes, intervals)
- Ear training (identify intervals, chords)
- Rhythm exercises (with metronome)

### Content Creation

- **Beginners**: Templates + wizard-guided flow
- **Power users**: Visual drag-and-drop builder
- **Both**: Preview mode to see student view before publishing

### Student Experience

Teacher-controlled per student/curriculum:
- **Linear progression**: Can't skip ahead, teacher unlocks content
- **Flexible with guidance**: Recommended path, but can explore freely

---

## Live Session Studio

The collaborative teaching workspace - the core of the live teaching experience.

### Layout Concept

```
┌────────────────────────────────────────────────────────────────┐
│  TOOLBAR: End Call | Record | Screen Share | Settings | Chat  │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  ┌──────────────────────────────────┐  ┌───────────────────┐  │
│  │         MAIN VIEW               │  │   SECONDARY       │  │
│  │    (spotlight content)          │  │   PANELS          │  │
│  │                                  │  │                   │  │
│  │  - Video call                   │  │  - Thumbnails of  │  │
│  │  - Fretboard                    │  │    other views    │  │
│  │  - Keyboard                     │  │  - Click to swap  │  │
│  │  - GP Sheet Music               │  │    to main        │  │
│  │  - Lesson Notes                 │  │                   │  │
│  │                                  │  │                   │  │
│  └──────────────────────────────────┘  └───────────────────┘  │
│                                                                │
├────────────────────────────────────────────────────────────────┤
│  CONTROL BAR: Teacher Spotlight Control | Student Override    │
└────────────────────────────────────────────────────────────────┘
```

### Spotlight System (Multi-Camera Metaphor)

- Teacher has "director" controls - clicks to spotlight any view for both participants
- Student sees teacher's spotlight by default
- Student can override locally without affecting teacher
- Visual indicator shows what teacher is spotlighting vs. student's override

### Synchronized State

- When teacher selects a scale/chord, student's tools update in real-time
- When teacher clicks a note on fretboard, it highlights on student's view
- GP file playback is synchronized
- Cursor/pointer sharing for "look here" moments

### Recording

- Captures: video streams, audio, tool state changes, spotlight switches
- Playback reconstructs the full session experience
- Students can review at their own pace
- Teachers can drop markers during recording ("Important concept", "Practice this section")

### Technical Implementation

- Video: Azure Communication Services (WebRTC)
- Sync: Azure SignalR for real-time tool state
- Recording: Composite video + event log for reconstruction

---

## Gamification System

### Progress-Based Elements (Daily Motivation)

| Element | Description |
|---------|-------------|
| **XP Points** | Earned for completing lessons, exercises, practice time, attendance |
| **Levels** | XP thresholds unlock new levels |
| **Streaks** | Consecutive days of practice with visual indicators |
| **Progress Bars** | Per-lesson, per-module, per-course completion |
| **Practice Time** | Weekly/monthly tracked with teacher/student goals |

### Achievement-Based Elements (Milestone Satisfaction)

| Category | Examples |
|----------|----------|
| **Mastery** | "Pentatonic Master" - completed all pentatonic scales |
| **Consistency** | "30-Day Streak", "100 Practice Sessions" |
| **Speed** | "Speed Demon" - played scale at 180 BPM accurately |
| **Exploration** | "Scale Explorer" - practiced 20 different scales |
| **Instrument** | "Multi-Instrumentalist" - practiced on 3+ instruments |

### Teacher Controls

- Create custom achievements for students
- Award bonus XP or special badges manually
- Set weekly XP/practice goals per student

---

## Scheduling & Notifications

### Scheduling Features

| Feature | Description |
|---------|-------------|
| **Teacher Availability** | Set recurring available time blocks |
| **Session Booking** | Students book from available slots |
| **Recurring Sessions** | Weekly lessons auto-generate |
| **Rescheduling** | Either party can request, other approves |
| **External Sync** | Export .ics feed for Google Calendar / Outlook |

### Notification Triggers

| Event | Recipients | Timing |
|-------|-----------|--------|
| Session booked | Both | Immediately |
| Session reminder | Both | 24h, 1h, 15min before |
| Session cancelled | Other party | Immediately |
| Assignment due | Student | 24h before, on due date |
| Achievement earned | Student | Immediately |
| Streak at risk | Student | Evening if no practice |
| Weekly summary | Both | Sunday evening |

### Engagement Newsletter (Automated Weekly)

- Upcoming sessions this week
- Practice stats (time, streak, XP earned)
- Recent achievements
- Last lesson summary (teacher notes)
- Assignments due
- Motivational message based on progress

---

## Technical Architecture

### High-Level System Architecture

```
                          CLIENTS
   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
   │   Web PWA   │    │  Installed  │    │   Future    │
   │  (Angular)  │    │  PWA Mobile │    │ Native Apps │
   └──────┬──────┘    └──────┬──────┘    └──────┬──────┘
          │                  │                  │
          └──────────────────┼──────────────────┘
                             │ HTTPS
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                      API GATEWAY                             │
│                (ASP.NET Core 10 + Auth)                      │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐           │
│  │  Auth   │ │ Content │ │Progress │ │Schedule │           │
│  │ Service │ │ Service │ │ Service │ │ Service │           │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘           │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐           │
│  │Licensing│ │  Live   │ │ Gamif.  │ │ Notif.  │           │
│  │ Service │ │ Session │ │ Service │ │ Service │           │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘           │
└────────────────────────────┬────────────────────────────────┘
                             │
        ┌────────────────────┼────────────────────┐
        ▼                    ▼                    ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  Azure SQL   │    │ Azure Blob   │    │ Azure Redis  │
│  (primary)   │    │  (media/GP)  │    │(cache/sync)  │
└──────────────┘    └──────────────┘    └──────────────┘

                             │
        ┌────────────────────┴────────────────────┐
        ▼                                         ▼
┌────────────────────────────┐    ┌──────────────────────────┐
│ Azure Communication        │    │         Stripe           │
│ Services                   │    │  - Subscriptions         │
│  - Video calls             │    │  - Marketplace payouts   │
│  - Email                   │    │                          │
│  - Chat                    │    │                          │
└────────────────────────────┘    └──────────────────────────┘
```

### Technology Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| **Frontend** | Angular 21 + PWA | Already built, excellent PWA support |
| **API** | ASP.NET Core 10 | Latest LTS, excellent Azure integration |
| **Auth** | ASP.NET Identity + OAuth | Built-in email + social login support |
| **Database** | Azure SQL (MS SQL Server) | Azure-native, familiar tooling |
| **Cache/Realtime** | Azure Cache for Redis | Managed Redis, WebSocket pub/sub |
| **Blob Storage** | Azure Blob Storage | Native integration, CDN support |
| **Communication** | Azure Communication Services | Video, email, chat - all-in-one |
| **Payments** | Stripe | Subscriptions, marketplace payouts |
| **Hosting** | Azure App Service + Azure SignalR | Managed hosting, WebSocket support |

---

## Core Data Models

### User & Authentication

```
User
├── Id (GUID)
├── Email
├── PasswordHash (nullable if social-only)
├── DisplayName
├── AvatarUrl
├── Role (Teacher | Student | Admin)
├── AuthProviders[] (Local, Google, Apple, Microsoft)
├── CreatedAt
└── Settings (JSON: notifications, preferences)

TeacherProfile (extends User)
├── UserId (FK)
├── Bio
├── IsPublic (open enrollment vs invite-only)
├── Instruments[]
├── Specializations[]
├── HourlyRate (optional)
└── RoyaltyPayoutAccount (Stripe Connect ID)

StudentProfile (extends User)
├── UserId (FK)
├── CurrentLevel
├── TotalXP
├── CurrentStreak
└── Instruments[]
```

### Teacher-Student Relationships

```
Enrollment
├── Id
├── TeacherId (FK)
├── StudentId (FK)
├── Status (Active | Paused | Completed)
├── ProgressionMode (Linear | Flexible)
├── StartedAt
└── AssignedCurriculumId (FK, nullable)

Invitation
├── Id
├── TeacherId (FK)
├── Email
├── Code (unique invite code)
├── ExpiresAt
└── AcceptedAt (nullable)
```

### Content Structure

```
Course
├── Id
├── TeacherId (FK - owner)
├── Title
├── Description
├── Difficulty (Beginner | Intermediate | Advanced)
├── IsPublished (marketplace visibility)
├── Price (for published courses)
├── Modules[]
└── CreatedAt / UpdatedAt

Module
├── Id
├── CourseId (FK)
├── Title
├── SortOrder
└── Lessons[]

Lesson
├── Id
├── ModuleId (FK)
├── Title
├── Description
├── Objectives[]
├── ContentBlocks[] (JSON - ordered array)
├── CompletionCriteria (JSON)
├── EstimatedDuration
└── SortOrder
```

### Progress & Gamification

```
LessonProgress
├── Id
├── StudentId (FK)
├── LessonId (FK)
├── Status (NotStarted | InProgress | Completed)
├── Score (nullable)
├── TimeSpent
├── CompletedAt
└── TeacherFeedback (nullable)

Achievement
├── Id
├── Name
├── Description
├── IconUrl
├── Criteria (JSON)
└── XPReward

StudentAchievement
├── StudentId (FK)
├── AchievementId (FK)
├── EarnedAt
└── AwardedBy (system | TeacherId)
```

### Scheduling

```
TeacherAvailability
├── Id
├── TeacherId (FK)
├── DayOfWeek (0-6)
├── StartTime
├── EndTime
├── RecurringWeekly (bool)
└── EffectiveFrom / EffectiveTo

ScheduledSession
├── Id
├── TeacherId (FK)
├── StudentId (FK)
├── StartTime
├── EndTime
├── Status (Scheduled | InProgress | Completed | Cancelled | NoShow)
├── RecurrenceRule (nullable)
├── MeetingLink (ACS room URL)
├── RecordingUrl (nullable)
└── Notes

SessionRecording
├── Id
├── SessionId (FK)
├── VideoUrl
├── EventLogUrl (JSON of state changes)
├── Duration
├── FileSize
├── CreatedAt
└── ExpiresAt (optional)
```

### Marketplace

```
PublishedCourse
├── Id
├── CourseId (FK)
├── TeacherId (FK)
├── Title, Description, PreviewVideoUrl, ThumbnailUrl
├── Price
├── Category, Difficulty, Tags[]
├── Rating (aggregated)
├── EnrollmentCount
├── Status (Active | Suspended | Retired)
└── PublishedAt

CoursePurchase
├── Id
├── CourseId (FK)
├── StudentId (FK)
├── PurchasePrice
├── PlatformFee
├── TeacherPayout
├── StripePaymentId
└── PurchasedAt
```

---

## PWA & Offline Architecture

### Cache Strategy

| Content Type | Strategy |
|--------------|----------|
| **Static Assets** | Cache-first (app shell, images, fonts, music theory data) |
| **User Content** | Cache + network update (downloaded lessons, GP files) |
| **Dynamic Data** | Network-first, cache fallback (schedule, notifications) |

### Offline Capabilities

| Feature | Offline Support |
|---------|-----------------|
| **Interactive Tools** | ✓ Full - Fretboard, keyboard, scale/chord explorer |
| **Downloaded Lessons** | ✓ View content, practice exercises |
| **GP File Playback** | ✓ If file previously cached |
| **Progress Tracking** | ✓ Queued locally, syncs when online |
| **Video Lessons** | ✗ Requires connection |
| **Live Sessions** | ✗ Requires connection |

### Local Storage (IndexedDB)

```
OfflineStore
├── CachedLessons[]
├── CachedGPFiles[]
├── PendingProgress[] (to sync when online)
├── UserPreferences
└── LastSyncTimestamp
```

---

## Security & Privacy

### Authentication

- ASP.NET Core Identity for email/password
- OAuth providers: Google, Apple, Microsoft
- JWT tokens: Access (15min), Refresh (7 days)

### Role-Based Access Control

| Resource | Teacher | Student | Admin |
|----------|---------|---------|-------|
| Own profile | Full | Full | Full |
| Create courses | ✓ | ✗ | ✓ |
| View own students | ✓ | ✗ | All |
| Access recordings | Own sessions | Own sessions | All |
| Publish to marketplace | ✓ | ✗ | ✓ |

### Data Ownership (Hybrid Model)

- Students own their learning data (progress, achievements)
- Teachers own their content (lessons, curriculum)
- Platform facilitates but doesn't "own" either
- GDPR-compliant export and deletion

### Privacy Considerations

- Parental consent flow for minors (COPPA, GDPR)
- Explicit consent before recording video sessions
- Clear data retention policies
- End-to-end encryption on ACS
- Recordings encrypted at rest

---

## Marketplace & Royalties

### Revenue Split

```
Student pays $50 for course
├── Stripe fee: ~$1.75 (3.5%)
├── Platform fee: $9.65 (20%)
└── Teacher payout: $38.60 (80%)
```

### Publishing Workflow

1. Teacher creates course (private)
2. Uses with own students, refines content
3. Clicks "Publish to Marketplace"
4. Completes review checklist (all lessons complete, pricing set, Stripe Connect linked)
5. Optional platform quality review
6. Published to marketplace

### Marketplace Features

- Search & filter by instrument, difficulty, rating, price
- Featured courses (platform-curated)
- Course preview (free first lesson or intro video)
- Ratings & reviews (verified purchases only)
- Teacher public profiles
- 7-day refund policy

---

## API Structure

### REST Endpoints

```
/api
├── /auth (register, login, refresh, OAuth)
├── /users (profile, notifications, preferences)
├── /teachers (profiles, availability, dashboard)
├── /students (enrollments, progress, achievements)
├── /courses (CRUD, publishing)
├── /lessons (content, progress, feedback)
├── /sessions (scheduling, live session control, recordings)
├── /schedule (availability, booking, calendar export)
├── /marketplace (browse, purchase, reviews)
├── /payments (subscriptions, invoices)
├── /royalties (earnings, payouts, Stripe Connect)
└── /live (ACS tokens, session state)
```

### SignalR Hubs

```
/hubs
├── /session (live teaching sync)
│   ├── JoinSession, LeaveSession
│   ├── BroadcastToolState
│   ├── SetSpotlight, SendPointer
│   └── AddMarker
└── /notifications (real-time alerts)
```

---

## Implementation Phases

### Phase 1: Foundation
- Upgrade to .NET 10
- Azure SQL + EF Core models
- Authentication (Identity + OAuth)
- User management (roles)
- Basic API structure
- Angular auth integration

### Phase 2: Teacher-Student Core (MVP)
- Teacher/student profiles
- Invitations + enrollment
- Course/lesson CRUD
- Content block system
- Progress tracking
- Basic dashboards

### Phase 3: Live Sessions
- ACS video integration
- SignalR real-time sync
- Live session UI
- Spotlight system
- Recording + playback
- Markers

### Phase 4: Scheduling & Engagement
- Availability management
- Booking flow
- Calendar views + sync
- Notifications (email, push, in-app)
- Weekly newsletter

### Phase 5: Gamification
- XP + levels
- Streaks
- Achievements
- Progress visualizations

### Phase 6: Payments & Licensing
- Stripe integration
- Subscriptions
- Usage tracking
- License verification

### Phase 7: Marketplace
- Publishing workflow
- Browse/search
- Stripe Connect payouts
- Purchases + reviews
- Royalty dashboard

### Phase 8: PWA & Polish
- Service worker + offline
- Background sync
- Performance optimization
- Security audit

---

## Open Questions (For Later)

1. **Pricing structure** - Finalize after understanding costs
2. **Privacy compliance** - Research COPPA, GDPR, Canadian laws based on target markets
3. **Content moderation** - Review process for marketplace courses
4. **Mobile native apps** - Evaluate need after PWA launch
5. **Expansion beyond music** - Architecture designed to support other educational domains

---

## Next Steps

1. Review and approve this design
2. Create detailed implementation plan for Phase 1
3. Set up Azure infrastructure
4. Begin development

---

*Generated through collaborative brainstorming session - 2026-01-20*
