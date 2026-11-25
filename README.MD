# EcoTrack
### Smart Waste Collection Monitoring and Resident Notification System

## 1. Project Overview

EcoTrack is a web-based waste collection monitoring system designed to improve communication and coordination between residents, garbage collectors, and barangay officials.

The system allows residents to view collection schedules, monitor collection activities, submit missed pickup reports, and receive SMS notifications about collection updates.

Garbage collectors can manage their assigned collection tasks, update collection progress, and share their location for tracking. Barangay officials can manage system information, monitor collection operations, and review collection records and reports.

## 2. Problem Statement

Traditional waste collection processes may experience communication gaps between residents, garbage collectors, and barangay officials. Residents may not know when garbage collectors will arrive, resulting in missed collections, improperly timed waste disposal, and inconvenience.

EcoTrack aims to address these challenges through digital collection monitoring, location tracking, missed pickup reporting, and SMS notifications.

## 3. Objectives

- Improve communication between residents and garbage collectors.
- Provide updated information about garbage collection activities.
- Notify residents when garbage collectors are on their way.
- Allow garbage collectors to update their collection progress.
- Help barangay officials monitor waste collection operations.
- Provide a system for reporting and monitoring missed pickups.
- Improve the efficiency and transparency of garbage collection.

## 4. Key Features

### Resident Module
- Resident account management.
- View garbage collection schedules.
- Monitor garbage collection activities.
- Receive SMS notifications about collection updates.
- View collection status and report updates.
- Submit and monitor missed pickup reports.
- Manage personal information, mobile number, and purok.

### Garbage Collector Module
- Collector account access.
- View assigned collection tasks.
- Update collection status and progress.
- Share location for live tracking.
- Notify residents when approaching their area.

### Barangay Official Module
- Dashboard for monitoring collection activities.
- Manage resident and collector information.
- Manage collection schedules and assignments.
- Monitor garbage collection progress.
- View collection records and reports.
- Monitor overdue and missed collection activities.

### SMS Notification
- Sends collection-related notifications to residents.
- Notifies residents when garbage collectors are on their way.
- Provides updates about missed pickup reports.
- Uses the uniSMS API for SMS integration through Supabase Edge Functions.

### Live Tracking
- Uses the browser's Geolocation API to obtain the garbage collector's location.
- Stores location updates through Supabase.
- Displays the collector's location on an interactive map.
- Supports monitoring of collection progress by authorized users.

*Note: Live tracking requires location permissions, an internet connection, and properly configured location updates.*

## 5. Technologies Used

| Technology | Purpose |
|---|---|
| HTML5 | Web page structure |
| CSS3 | User interface and styling |
| JavaScript (ES Modules) | Frontend functionality |
| TypeScript | Supabase Edge Function development |
| Supabase | Backend services and database platform |
| PostgreSQL | Database management |
| Supabase Auth | User authentication |
| Supabase Realtime | Real-time data updates |
| Supabase Edge Functions | Server-side operations and integrations |
| Supabase JavaScript Client | Connects the frontend to Supabase |
| uniSMS API | Sends SMS notifications |
| Browser Geolocation API | Obtains the collector's location |
| Map API/Library | Displays maps and location information |
| Node.js and npm | Development environment and package management |
| Supabase CLI | Manages and deploys Supabase services |
| Prettier | Code formatting |
| Git | Version control |
| Visual Studio Code | Code editor |

## 6. System Requirements

- Windows, macOS, or Linux computer.
- Modern web browser.
- Internet connection.
- Supabase account and project.
- Visual Studio Code or another code editor.
- Node.js and npm.
- Supabase CLI.
- Configured uniSMS account and API credentials.
- Configured map service or library.
- Browser location permissions for collector tracking.

## 7. Installation and Setup

### Step 1: Clone or Download the Repository

Clone the repository:

```bash
git clone YOUR_REPOSITORY_URL
```

Alternatively, download and extract the project ZIP file.

Open the EcoTrack project folder in Visual Studio Code.

### Step 2: Install Project Dependencies

Open the terminal inside the project folder and run:

```powershell
npm.cmd install
```

This installs the development dependencies listed in `package.json`, including Prettier and Supabase CLI.

### Step 3: Configure Supabase

1. Create a Supabase project.
2. Open your Supabase project dashboard.
3. Locate your Project URL and publishable key.
4. Configure the credentials in the project's JavaScript configuration file.
5. Save the configuration.

**Important:** Never expose your Supabase secret key or service role key in frontend JavaScript files.

### Step 4: Set Up the Database

1. Open the Supabase SQL Editor.
2. Locate the SQL scripts included in the project.
3. Execute the required database setup and migration scripts in the correct order.
4. Verify that the required tables, relationships, functions, and Row Level Security (RLS) policies are created.

### Step 5: Configure Supabase Edge Functions

Log in to Supabase:

```powershell
npx.cmd supabase login
```

Link the local project to your Supabase project:

```powershell
npx.cmd supabase link --project-ref YOUR_PROJECT_REF
```

Configure the required environment secrets, then deploy the functions:

```powershell
npx.cmd supabase functions deploy send-sms
npx.cmd supabase functions deploy escalate-overdue
```

Deploy `test-sms` separately if it is included and needed for testing.

### Step 6: Configure SMS Integration

EcoTrack uses the uniSMS API for SMS notifications.

1. Set up a uniSMS account.
2. Obtain the required API credentials.
3. Configure the required secrets in Supabase.
4. Set the SMS configuration variables, including `UNISMS_API_KEY`, `UNISMS_SENDER_ID`, and `SMS_ENABLED`.
5. Test the SMS integration before sending messages to actual residents.

Keep all SMS API credentials in secure environment secrets, not in frontend JavaScript.

### Step 7: Run the System

Open the project using a local development server.

You can use the Visual Studio Code Live Server extension or another suitable local web server.

Make sure your Supabase configuration is correct before testing the system.

## 8. Project Structure

The following is a general representation of the EcoTrack project structure. Actual filenames and folders should match the repository.

```text
EcoTrack-v4/
│
├── index.html
├── resident.html
├── collector.html
├── official.html
├── package.json
├── package-lock.json
├── .gitignore
├── .prettierignore
├── README.md
│
├── css/
│   └── style.css
│
├── js/
│   ├── config.js
│   ├── common.js
│   ├── auth.js
│   ├── resident.js
│   ├── collector.js
│   └── official.js
│
└── supabase/
    └── functions/
        ├── _shared/
        │   └── sms.ts
        ├── send-sms/
        │   └── index.ts
        ├── escalate-overdue/
        │   └── index.ts
        └── test-sms/
            └── index.ts
```

*Note: This is a representative structure. Update it to reflect the actual folders and files in your repository.*

## 9. Security and Privacy

- Never expose secret API keys in frontend code.
- Apply appropriate Supabase Row Level Security (RLS) policies.
- Restrict access based on user roles.
- Protect residents' personal information and mobile numbers.
- Store SMS gateway credentials using secure environment secrets.
- Request location access only when necessary for tracking.
- Ensure that only authorized users can access relevant collection and location information.

## 10. Testing

The system should be tested for the following:

- User registration and login.
- Role-based access and permissions.
- Resident and collector account management.
- Collection schedule management.
- Collection task assignments.
- Collection status updates.
- Live location tracking.
- SMS notification delivery.
- Missed pickup reporting and updates.
- Database operations.
- Security and access restrictions.

## 11. Project Status

**Development Status:** In Development

EcoTrack is being developed to support more organized, transparent, and efficient barangay waste collection operations. Its features are subject to configuration, integration, and testing before deployment.

## 12. Developers

**Project Name:** EcoTrack v4

**Project Type:** Web-Based Waste Collection Monitoring and Resident Notification System

**Development Team:** [Insert Team Name]

**Institution:** [Insert School/University]

**Academic Year:** [Insert Academic Year]

---

*EcoTrack — Making Waste Collection Smarter, More Organized, and More Connected.*
