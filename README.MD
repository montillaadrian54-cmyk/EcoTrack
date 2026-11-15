
# EcoTrack v4
### Smart Waste Collection Monitoring and Resident Notification System

## 1. Project Overview

EcoTrack is a web-based waste management system designed to improve communication and coordination between residents, garbage collectors, and barangay officials.

The system allows residents to monitor garbage collection activities, receive notifications when garbage collectors are on their way, and stay informed about collection updates.

Garbage collectors can manage their assigned collection tasks and update their collection status, while barangay officials can monitor collection activities and manage system information.

## 2. Problem Statement

Traditional waste collection processes may experience communication gaps between residents, garbage collectors, and barangay officials. Residents may not know when garbage collectors will arrive, resulting in missed collections, improperly timed waste disposal, and inconvenience.

EcoTrack aims to address these problems through digital collection monitoring, live tracking, and SMS notifications.

## 3. Objectives

- Improve communication between residents and garbage collectors.
- Provide real-time or updated information about garbage collection activities.
- Notify residents when garbage collectors are on their way.
- Allow garbage collectors to update their collection progress.
- Help barangay officials monitor waste collection operations.
- Improve the efficiency and transparency of garbage collection.

## 4. Key Features

### Resident Module
- Resident account management.
- View garbage collection schedules.
- Monitor garbage collection activities.
- Receive SMS notifications when collectors are on their way.
- View collection status and updates.

### Garbage Collector Module
- Collector account access.
- View assigned collection tasks.
- Update collection status.
- Share location for live tracking.
- Notify residents when approaching their area.

### Barangay Official Module
- Dashboard for monitoring collection activities.
- Manage resident and collector information.
- Manage collection schedules and assignments.
- Monitor garbage collection progress.
- View collection records and reports.

### SMS Notification
- Sends notifications to residents about upcoming garbage collection.
- Informs residents when garbage collectors are on their way.
- Uses an SMS gateway or provider integrated with the system.

### Live Tracking
- Displays the garbage collector's location on a map.
- Allows residents and officials to monitor collection progress.
- Uses location updates to provide tracking information.

## 5. Technologies Used

| Technology | Purpose |
|---|---|
| HTML | Web page structure |
| CSS | User interface and styling |
| JavaScript | Frontend functionality |
| Supabase | Backend and database |
| PostgreSQL | Database management |
| Supabase Auth | User authentication |
| Supabase Realtime | Real-time data updates |
| TypeScript | Edge Function development |
| Supabase Edge Functions | Server-side operations and integrations |
| Map API/Library | Map display and location tracking |
| SMS Gateway/API | Sending SMS notifications |

## 6. System Requirements

- Windows, macOS, or Linux computer
- Modern web browser
- Internet connection
- Supabase account and project
- Code editor (Visual Studio Code recommended)
- Configured SMS gateway or provider
- Configured map service, if required

## 7. Installation and Setup

### Step 1: Clone or Download the Repository

Download the project or clone the repository:

```bash
git clone YOUR_REPOSITORY_URL
```

Open the project folder in Visual Studio Code.

### Step 2: Configure Supabase

1. Create a Supabase project.
2. Open your Supabase project dashboard.
3. Locate your Project URL and publishable key.
4. Configure the credentials in the appropriate project configuration file.

**Important:** Never expose your Supabase secret key or service role key in frontend JavaScript files.

### Step 3: Set Up the Database

1. Open the Supabase SQL Editor.
2. Locate the SQL scripts included in the project.
3. Run the required database setup and migration scripts in the correct order.
4. Verify that the required tables, relationships, and policies are created.

### Step 4: Configure Edge Functions

1. Install the Supabase CLI.
2. Log in to your Supabase account.
3. Link your local project to your Supabase project.
4. Configure the required environment secrets.
5. Deploy the Edge Functions.

Example:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy
```

### Step 5: Configure SMS Integration

1. Set up your chosen SMS gateway or provider.
2. Configure the required API credentials securely.
3. Verify that the SMS integration can send messages.
4. Test the notification process before using actual resident phone numbers.

### Step 6: Run the System

Open the project's main HTML file using a local development server.

You can use the VS Code Live Server extension or another local web server.

Make sure your Supabase configuration is correct before testing the system.

## 8. Project Structure

```text
EcoTrack-v4/
│
├── index.html
├── resident.html
├── collector.html
├── official.html
│
├── css/
│   └── style.css
│
├── js/
│   ├── config.js
│   ├── supabase.js
│   ├── auth.js
│   ├── resident.js
│   ├── collector.js
│   └── official.js
│
├── supabase/
│   ├── migrations/
│   └── functions/
│
├── README.md
└── .gitignore
```

*Note: This is an example structure. Adjust it to match the actual files and folders in your project.*

## 9. Security and Privacy

- Do not expose secret API keys in frontend code.
- Apply appropriate Supabase Row Level Security (RLS) policies.
- Restrict access based on user roles.
- Protect residents' personal information and phone numbers.
- Secure SMS gateway credentials using environment secrets.
- Request location access only when necessary for tracking.

## 10. Testing

The system should be tested for:

- User registration and login.
- Role-based access.
- Resident and collector data management.
- Collection schedule management.
- Collection status updates.
- Live location tracking.
- SMS notification delivery.
- Database operations.
- Security and access restrictions.

## 11. Project Status

**Development Status:** [In Development / Completed]

EcoTrack is being developed to support more organized, transparent, and efficient waste collection operations.

## 12. Developers

**Project Name:** EcoTrack v4

**Project Type:** Web-Based Waste Management System

**Development Team:** [Insert Team Name]

**Institution:** [Insert School/University]

**Academic Year:** [Insert Academic Year]

---

*EcoTrack — Making Waste Collection Smarter, More Organized, and More Connected.*
