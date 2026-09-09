# Domain & SSL Manager --- Claude Build Specification

## 1. Project Objective

Build a production-ready, secure web application for centralized
management of domains, SSL/TLS certificates, servers, DNS providers,
expiry monitoring, notifications, certificate issuance, automatic
renewal, and automatic certificate installation.

The application must be able to:

-   Add, edit, verify, monitor, and delete domains.
-   Discover and verify domain expiry dates using authoritative
    domain-registration data such as RDAP and supported registrar APIs.
-   Inspect the live SSL/TLS certificate served by each domain over
    HTTPS.
-   Compare stored dates with freshly discovered dates and clearly
    identify mismatches.
-   Monitor domain and SSL expiry continuously.
-   Notify administrators before expiry, with 5 days being the mandatory
    critical alert threshold.
-   Support free publicly trusted SSL certificates through ACME
    providers, primarily Let's Encrypt.
-   Automatically renew certificates where automation is supported.
-   Automatically install renewed certificates on supported servers.
-   Support Nginx and Apache initially.
-   Support SSH-based server management using secure, restricted
    credentials.
-   Support DNS-01 automation for supported DNS providers, initially
    Cloudflare.
-   Validate server configuration before reload.
-   Automatically verify the live certificate after installation.
-   Roll back to the previous known-good certificate/configuration if
    deployment fails.
-   Maintain detailed audit logs for every automated and manual
    operation.

The product should feel like a professional enterprise DevOps/SaaS
control panel, not a generic hosting panel.

------------------------------------------------------------------------

# 2. Core Product Principle

The application must never blindly trust manually entered expiry dates.

For every domain:

1.  User adds domain.
2.  System performs a fresh domain-expiry lookup.
3.  System connects to the live HTTPS endpoint.
4.  System inspects the actual certificate.
5.  System compares discovered values against stored values.
6.  System displays whether the information is verified.
7.  Only after successful verification should automation be enabled by
    default.
8.  Every check must record timestamp, source, result, and errors.

Example:

``` text
example.com

Domain expiry:
RDAP              2027-02-15
Registrar API      2027-02-15
Stored value       2027-01-15

Status:
⚠ DATE MISMATCH

SSL expiry:
Live certificate  2026-10-30
Stored value       2026-10-30

Status:
✓ VERIFIED
```

------------------------------------------------------------------------

# 3. Recommended Technology Stack

Use a modern TypeScript full-stack architecture.

## Frontend

-   Next.js App Router
-   React
-   TypeScript with strict mode
-   Tailwind CSS
-   shadcn/ui / Radix UI
-   Lucide React
-   Framer Motion for subtle UI transitions
-   TanStack Query where appropriate
-   React Hook Form
-   Zod validation

## Backend

-   Next.js server/API routes where appropriate
-   Node.js/TypeScript service layer
-   Prisma ORM
-   PostgreSQL

## Background Processing

Use:

-   Redis
-   BullMQ

Do not perform long-running domain scans, SSL scans, certificate
issuance, SSH operations, or notification jobs directly inside normal
HTTP requests.

Use background jobs.

## Infrastructure

Recommended deployment:

``` text
Web application
Next.js

Worker
Node.js + BullMQ

Database
PostgreSQL

Queue
Redis

Reverse proxy
Nginx

SSL
ACME / Let's Encrypt

Server management
SSH

DNS
Cloudflare API initially
```

------------------------------------------------------------------------

# 4. High-Level Architecture

``` text
                    ┌──────────────────────┐
                    │      Next.js UI      │
                    │ Dashboard / Admin    │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │     API Layer        │
                    │ Auth / Validation    │
                    └──────────┬───────────┘
                               │
              ┌────────────────┼─────────────────┐
              │                │                 │
              ▼                ▼                 ▼
        PostgreSQL           Redis           External APIs
          Prisma           BullMQ          RDAP / DNS / CA
              │                │                 │
              │                ▼                 │
              │          Worker Service         │
              │                │                 │
              │       ┌────────┼─────────┐       │
              │       ▼        ▼         ▼       │
              │     Domain    SSL       SSH      │
              │     Checks   Engine    Manager    │
              │                         │         │
              │                         ▼         │
              │                    Nginx/Apache   │
              │                                  │
              └──────────────────────────────────┘
```

------------------------------------------------------------------------

# 5. Navigation

The primary navigation should contain:

``` text
Dashboard

Domains
Certificates
Servers
DNS Providers

Notifications
Automation Logs
Reports

Settings
```

Optional future navigation:

``` text
Users
Teams
API Keys
Integrations
System Health
```

The sidebar should remain visible on desktop and collapse to an
icon/mobile drawer on smaller screens.

------------------------------------------------------------------------

# 6. Visual Design System

## Design direction

Create a clean, modern, high-fidelity enterprise SaaS interface.

Characteristics:

-   White/light gray primary surfaces.
-   Very subtle borders.
-   Rounded cards.
-   Strong visual hierarchy.
-   Compact but readable tables.
-   Blue primary action color.
-   Green for healthy/success.
-   Amber for warning/expiring.
-   Red for critical/expired/error.
-   Purple can be used for infrastructure/server-related metrics.
-   Avoid excessive gradients.
-   Avoid oversized decorative elements.
-   Use icons to reinforce status.
-   Use whitespace generously.
-   Prioritize information density without clutter.

## Typography

Recommended:

``` text
Font:
Inter

Page title:
28–32px / 700

Section title:
18–20px / 600

Card metric:
26–32px / 700

Body:
14–15px / 400

Small metadata:
12–13px / 400

Table:
13–14px
```

## Radius

``` text
Cards: 12–16px
Buttons: 8–10px
Inputs: 8px
Badges: 9999px
```

## Shadows

Use very subtle shadows only where useful.

Prefer borders over heavy shadows.

------------------------------------------------------------------------

# 7. Dashboard

Route:

``` text
/dashboard
```

## Header

Display:

``` text
Dashboard

Monitor your domains, SSL certificates and servers.

[Search domains, servers...]

Notification icon
User avatar
Admin menu
```

## Metric cards

Four primary cards:

``` text
Total Domains
42

SSL Certificates
38

Servers
12

Pending Notifications
5
```

Secondary status cards:

``` text
Expiring Soon
5

Expired
2

SSL Errors
4
```

Each card should be clickable and navigate to the relevant filtered
page.

## Domain overview table

Columns:

``` text
Domain
SSL Expiry
Domain Expiry
Status
Automation
Actions
```

Example:

``` text
example.com
72 days
160 days
Healthy
ON
View

example.ae
4 days
21 days
Expiring
ON
View

example.org
93 days
12 days
Domain Expiring
ON
View

testsite.com
28 days
364 days
Healthy
OFF
View
```

## Status chart

Show a donut chart:

``` text
Healthy
Expiring
Expired
SSL Error
```

## Recent automation activity

Display latest jobs:

``` text
SSL Renewal
example.com
Success
2 min ago

Domain Check
example.ae
Success
10 min ago

SSL Installation
example.org
Failed
18 min ago
```

------------------------------------------------------------------------

# 8. Domain List

Route:

``` text
/domains
```

Header:

``` text
Domains

Manage and monitor all domains.

[Search domain...]

[All Status]
[All Environments]

[+ Add Domain]
```

Table:

``` text
Domain
Registrar
SSL Expiry
Domain Expiry
Status
Automation
Last Checked
Actions
```

Actions:

``` text
View
Edit
Verify Now
Renew SSL
More
```

More menu:

``` text
Verify
Renew SSL
Install SSL
Disable Automation
View Logs
Delete
```

Deletion must require confirmation.

------------------------------------------------------------------------

# 9. Add Domain

Route:

``` text
/domains/new
```

Page title:

``` text
Add New Domain

Configure and verify domain and SSL settings.
```

## Domain Information

Fields:

``` text
Domain Name
example.com

Environment
Production / Staging / Development

Registrar
GoDaddy / Namecheap / Cloudflare / Other / Unknown

SSL Provider
Let's Encrypt / ZeroSSL / Existing Certificate / Other
```

## Automation settings

``` text
Auto Renewal
ON/OFF

Auto Installation
ON/OFF

DNS Automation
ON/OFF
```

## Notifications

Checkboxes:

``` text
Email
WhatsApp
Telegram
Slack
```

## Alert threshold

Default:

``` text
5 days
```

Allow custom values.

## Server assignment

``` text
Server
Production Server 01

Web Server
Nginx
```

## Primary action

``` text
[Add Domain & Verify]
```

Do not simply save the domain.

On submission:

``` text
Create record
      ↓
Queue verification
      ↓
RDAP/domain check
      ↓
SSL check
      ↓
DNS check
      ↓
Return verification result
```

------------------------------------------------------------------------

# 10. Domain Verification Screen

After adding a domain, show a verification workflow.

Example:

``` text
Verifying example.com

✓ Domain reachable
✓ RDAP lookup complete
✓ Domain expiry discovered
✓ HTTPS reachable
✓ SSL certificate discovered
✓ Certificate hostname verified
✓ Certificate chain verified
✓ Dates stored
```

Then show:

``` text
Verification Result

✓ Domain verified
✓ SSL verified
✓ Dates match

[Continue]
```

If mismatch:

``` text
⚠ Verification requires attention

Domain expiry mismatch

RDAP:
2027-02-15

Registrar:
2027-02-15

Stored:
2027-01-15

[Update Stored Date]
[Review]
```

Never silently overwrite a manually verified value without showing an
audit entry.

------------------------------------------------------------------------

# 11. Domain Details

Route:

``` text
/domains/[id]
```

Header:

``` text
Back to Domains

example.com
[Healthy]

[Edit]
[Verify Now]
[More]
```

Tabs:

``` text
Overview
Domain
SSL Certificate
Server
History
```

## Overview

Top status panel:

``` text
✓ Dates Verified

Domain and SSL expiry dates are correct and up to date.

Last checked:
09 Sep 2026 09:00

[Recheck]
```

## Domain information card

``` text
Registrar
GoDaddy

Registered
15 Feb 2024

Expires
15 Feb 2027

Status
Active

Verification
Verified

[View RDAP]
```

## SSL card

``` text
Issuer
Let's Encrypt

Valid From
01 Aug 2026

Valid Until
30 Oct 2026

Days Remaining
51 days

Status
Valid

[View Certificate]
```

## Server card

``` text
Production Server 01
Nginx
Online

Certificate Installed
Yes

Last Deployment
09 Sep 2026
```

------------------------------------------------------------------------

# 12. SSL Certificates List

Route:

``` text
/certificates
```

Columns:

``` text
Certificate
Domain
Issuer
Valid From
Expires
Days Remaining
Status
Installation
Actions
```

Status examples:

``` text
Valid
Expiring
Expired
Hostname Mismatch
Invalid Chain
Deployment Failed
```

Filters:

``` text
All
Valid
Expiring
Expired
Errors
```

------------------------------------------------------------------------

# 13. SSL Certificate Details

Route:

``` text
/certificates/[id]
```

Header:

``` text
SSL Certificate - example.com
[Valid]
```

Tabs:

``` text
Overview
Certificate Details
Chain
Installation
History
```

## Certificate details

Display:

``` text
Issuer
Let's Encrypt

Type
ECDSA (P-256)

Valid From
01 Aug 2026

Expires
30 Oct 2026

Serial Number
...

Fingerprint
...

Signature Algorithm
...

TLS Version
TLS 1.2 / TLS 1.3
```

## SAN section

Show:

``` text
example.com
www.example.com
```

## Certificate status checks

``` text
✓ Valid Certificate
✓ Hostname Match
✓ Chain Valid
✓ TLS Supported
```

------------------------------------------------------------------------

# 14. SSL Request / Renewal

Route:

``` text
/certificates/new
```

Page:

``` text
Request SSL Certificate

Get a new SSL certificate from an ACME provider or use an existing certificate.
```

Fields:

``` text
Domain
example.com

Certificate Provider
Let's Encrypt

Certificate Type
Single Domain
Wildcard
Multi-Domain

Validation
HTTP-01
DNS-01

Install automatically
ON
```

If DNS-01:

``` text
DNS Provider
Cloudflare

Zone
example.com

[x] Automatically create DNS challenge record
```

If installation enabled:

``` text
Server
Production Server 01

Web Server
Nginx
```

Primary:

``` text
[Request Certificate]
```

------------------------------------------------------------------------

# 15. Automatic SSL Renewal Workflow

The worker should implement:

``` text
Check certificate
        ↓
Days remaining <= renewal threshold?
        ↓
Request ACME renewal
        ↓
Perform validation
        ↓
Receive certificate
        ↓
Backup current certificate
        ↓
Install new certificate
        ↓
Test Nginx/Apache configuration
        ↓
Reload server
        ↓
Perform live HTTPS verification
        ↓
Success?
   /          \
 YES           NO
 ↓             ↓
Complete     Rollback
                ↓
             Alert
```

Use a renewal threshold such as 30 days by default, while retaining the
mandatory 5-day alert.

Do not wait until 5 days before starting renewal.

------------------------------------------------------------------------

# 16. Server Management

Route:

``` text
/servers
```

Header:

``` text
Servers

Manage servers and SSH connections.

[+ Add Server]
```

Table:

``` text
Name
IP / Host
Status
Web Server
Domains
Last Check
Actions
```

Example:

``` text
Production Server 01
192.168.x.x
Online
Nginx
14
2 min ago

Staging Server
192.168.x.x
Online
Apache
8
4 min ago

Backup Server
192.168.x.x
Offline
Nginx
2
8 min ago
```

------------------------------------------------------------------------

# 17. Add Server

Fields:

``` text
Server Name
Host
Port
Username

Authentication
SSH Key
Password

Web Server
Nginx
Apache

Operating System
Ubuntu
Debian
CentOS/RHEL
Other
```

Never store plaintext passwords.

Prefer encrypted SSH keys or a secret manager.

Buttons:

``` text
[Test Connection]
[Save Server]
```

------------------------------------------------------------------------

# 18. Server Details

Show:

``` text
Server status
Online

Operating System
Ubuntu 24.04

Web Server
Nginx

SSH
Connected

Domains
14

Certificates
13

Last Health Check
2 min ago
```

Tabs:

``` text
Overview
Domains
Certificates
Configuration
Activity
```

Do not expose arbitrary shell execution in the UI.

Use predefined operations only:

``` text
Test SSH
Check Nginx
Check Apache
Install Certificate
Reload Web Server
Verify SSL
```

------------------------------------------------------------------------

# 19. DNS Providers

Route:

``` text
/dns
```

Initial providers:

``` text
Cloudflare
```

Future:

``` text
AWS Route 53
GoDaddy
Namecheap
DigitalOcean
Azure DNS
Google Cloud DNS
```

Provider cards:

``` text
Cloudflare

Connected
12 zones

[Manage]
```

Connection form:

``` text
Provider
Cloudflare

API Token
**************

Zone Access
Selected zones / All zones

[Test Connection]
```

Store API tokens encrypted.

Never return the full token to the frontend.

------------------------------------------------------------------------

# 20. Notifications

Route:

``` text
/notifications
```

Notification settings:

## SSL expiry alerts

Default:

``` text
30 days
15 days
7 days
5 days
```

## Domain expiry alerts

Default:

``` text
60 days
30 days
15 days
7 days
5 days
```

## Channels

``` text
Email
WhatsApp
Telegram
Slack
```

Each channel should have:

``` text
Enabled
Configuration
Test Notification
```

------------------------------------------------------------------------

# 21. Notification templates

Example SSL warning:

``` text
SSL Certificate Expiring

Domain: example.com
Certificate: Let's Encrypt
Expires: 14 Sep 2026
Remaining: 5 days

Automatic renewal:
Enabled

Server:
Production Server 01
```

Critical alert:

``` text
CRITICAL: SSL Certificate Expires Tomorrow

Domain:
example.com

Expires:
10 Sep 2026

Automatic renewal:
FAILED

Reason:
DNS validation failed.

Immediate action required.
```

------------------------------------------------------------------------

# 22. Automation Logs

Route:

``` text
/logs
```

Table:

``` text
Date
Domain
Action
Status
Duration
Details
```

Actions:

``` text
Domain Check
SSL Check
SSL Renewal
SSL Installation
DNS Validation
Server Check
Notification
Rollback
```

Statuses:

``` text
Success
Running
Failed
Rolled Back
Cancelled
```

Clicking an entry opens detailed logs.

Example:

``` text
SSL Renewal - example.com

09:01 Starting renewal
09:01 ACME account verified
09:01 DNS challenge created
09:02 DNS validation completed
09:02 Certificate issued
09:02 Existing certificate backed up
09:02 New certificate installed
09:02 nginx -t
09:02 Configuration valid
09:02 Nginx reloaded
09:03 HTTPS verification successful

Result:
✓ SUCCESS
```

------------------------------------------------------------------------

# 23. Settings

Tabs:

``` text
General
Integrations
Security
Users
System
```

## Integrations

Show:

``` text
Let's Encrypt
Connected

Cloudflare
Connected

GoDaddy
Not Connected

Namecheap
Not Connected

Telegram
Not Connected

Slack
Not Connected
```

## Security

Settings:

``` text
Two-factor authentication
Session timeout
IP allowlist
Login protection
Audit logging
```

------------------------------------------------------------------------

# 24. Reports

Route:

``` text
/reports
```

Useful reports:

``` text
Domain Expiry Report
SSL Expiry Report
Failed Renewals
Server Health
Automation Success Rate
Notification History
```

Allow:

``` text
Export CSV
Export PDF
```

------------------------------------------------------------------------

# 25. Domain Verification Engine

Implement a service abstraction.

``` ts
interface DomainVerificationService {
  verify(domain: string): Promise<DomainVerificationResult>;
}
```

Result:

``` ts
interface DomainVerificationResult {
  domain: string;
  domainExpiry?: Date;
  registrar?: string;
  registrationStatus?: string;
  source: string;
  verified: boolean;
  error?: string;
}
```

Prefer RDAP over legacy WHOIS wherever available.

Provider-specific registrar APIs should be optional adapters.

------------------------------------------------------------------------

# 26. SSL Inspection Engine

Create:

``` ts
interface CertificateInspector {
  inspect(domain: string, port?: number): Promise<CertificateInspection>;
}
```

Inspect:

``` text
Subject
Issuer
SAN
Valid From
Valid Until
Serial Number
Fingerprint
Signature Algorithm
TLS Version
Certificate Chain
Hostname Match
```

The inspector must connect to the live endpoint and not rely on stored
certificate data.

------------------------------------------------------------------------

# 27. SSL Provider Abstraction

Use:

``` ts
interface CertificateProvider {
  createCertificate(request: CertificateRequest): Promise<Certificate>;
  renewCertificate(certificateId: string): Promise<Certificate>;
  revokeCertificate(certificateId: string): Promise<void>;
}
```

Initial implementation:

``` text
Let'sEncryptProvider
```

Future:

``` text
ZeroSSLProvider
CustomACMEProvider
```

------------------------------------------------------------------------

# 28. DNS Provider Abstraction

Use:

``` ts
interface DNSProvider {
  createRecord(input: DNSRecordInput): Promise<void>;
  updateRecord(input: DNSRecordInput): Promise<void>;
  deleteRecord(input: DNSRecordInput): Promise<void>;
  findZone(domain: string): Promise<DNSZone>;
}
```

Initial:

``` text
CloudflareProvider
```

------------------------------------------------------------------------

# 29. Server Deployment Abstraction

Use:

``` ts
interface ServerDeploymentProvider {
  testConnection(serverId: string): Promise<TestResult>;

  installCertificate(
    serverId: string,
    certificate: Certificate
  ): Promise<DeploymentResult>;

  testConfiguration(
    serverId: string
  ): Promise<TestResult>;

  reloadWebServer(
    serverId: string
  ): Promise<TestResult>;

  rollback(
    serverId: string,
    backupId: string
  ): Promise<RollbackResult>;
}
```

Initial:

``` text
SSH + Nginx
SSH + Apache
```

------------------------------------------------------------------------

# 30. Nginx Installation

Controlled workflow:

``` text
Backup current certificate
Backup current configuration
Upload new certificate
Upload private key
Set secure file permissions
Run nginx configuration test
If valid:
    reload nginx
Else:
    rollback
Verify HTTPS
```

Never reload if configuration testing fails.

------------------------------------------------------------------------

# 31. Apache Installation

Workflow:

``` text
Backup current certificate
Backup configuration
Install certificate
Update VirtualHost if required
Run apachectl configtest
If valid:
    reload Apache
Else:
    rollback
Verify HTTPS
```

------------------------------------------------------------------------

# 32. Security Requirements

This is a security-sensitive application because it may control
production servers.

Implement:

-   Strong authentication.
-   Password hashing with Argon2id or equivalent.
-   Optional/required 2FA for privileged users.
-   Role-based access control.
-   Secure HTTP-only cookies.
-   CSRF protection where applicable.
-   Strict CORS configuration.
-   Rate limiting.
-   Input validation with Zod.
-   SQL injection protection through Prisma.
-   XSS protection.
-   Content Security Policy.
-   HSTS.
-   Secure headers.
-   Encryption at rest for credentials.
-   Secrets stored outside source code.
-   Audit logging.
-   SSH host-key verification.
-   No arbitrary shell commands from user input.
-   Command allowlisting.
-   Least-privilege server accounts.

Roles:

``` text
Owner
Admin
Operator
Viewer
```

Permissions should include:

``` text
domains.read
domains.write
domains.delete

certificates.read
certificates.issue
certificates.renew
certificates.install

servers.read
servers.manage

dns.read
dns.manage

notifications.manage

users.manage
settings.manage
```

------------------------------------------------------------------------

# 33. Credential Security

Sensitive values include:

``` text
SSH private keys
SSH passwords
DNS API tokens
Registrar API credentials
ACME account credentials
Notification provider secrets
```

Never expose these through normal API responses.

Recommended approach:

``` text
Application
    ↓
Encryption service
    ↓
Encrypted database value
```

Use a server-side encryption key from environment/secret management.

For production, support external secret managers later:

``` text
AWS Secrets Manager
Azure Key Vault
HashiCorp Vault
```

------------------------------------------------------------------------

# 34. Audit Logging

Every sensitive action must be recorded.

Example:

``` text
User:
admin@example.com

Action:
SSL_INSTALL

Domain:
example.com

Server:
Production Server 01

Result:
SUCCESS

IP:
...

Timestamp:
...
```

Audit events:

``` text
LOGIN
LOGOUT
DOMAIN_CREATED
DOMAIN_UPDATED
DOMAIN_DELETED
DOMAIN_VERIFIED
SSL_INSPECTED
SSL_REQUESTED
SSL_RENEWED
SSL_INSTALLED
SSL_ROLLBACK
SERVER_CREATED
SERVER_UPDATED
SERVER_CONNECTION_TESTED
DNS_RECORD_CREATED
DNS_RECORD_DELETED
NOTIFICATION_SENT
SETTINGS_UPDATED
```

------------------------------------------------------------------------

# 35. Database Model

Use Prisma.

Suggested models:

``` text
User
Role
Domain
Certificate
CertificateDeployment
Server
DNSProvider
DNSZone
NotificationChannel
NotificationRule
Notification
AutomationJob
AuditLog
VerificationResult
CertificateHistory
ServerBackup
Integration
```

## Domain

Suggested fields:

``` text
id
hostname
environment
registrar
registeredAt
expiresAt
verifiedExpiresAt
status
autoRenew
autoInstall
dnsAutomation
serverId
createdAt
updatedAt
lastCheckedAt
```

## Certificate

``` text
id
domainId
issuer
subject
serialNumber
fingerprint
validFrom
validUntil
sans
signatureAlgorithm
tlsVersion
status
provider
createdAt
updatedAt
lastCheckedAt
```

## Server

``` text
id
name
host
port
username
encryptedCredential
authenticationType
operatingSystem
webServer
status
lastHealthCheck
createdAt
updatedAt
```

## AutomationJob

``` text
id
type
domainId
certificateId
serverId
status
startedAt
completedAt
error
metadata
createdAt
```

------------------------------------------------------------------------

# 36. Job Queue Design

Use separate queues:

``` text
domain-check
ssl-check
ssl-renewal
ssl-installation
dns-validation
server-health
notification
```

Daily scheduler:

``` text
Every day:
    Queue domain checks
    Queue SSL checks
    Calculate expiry
    Queue notifications
    Queue eligible renewals
```

Renewal jobs should be idempotent.

Do not create duplicate renewal jobs for the same certificate.

Use distributed locks where required.

------------------------------------------------------------------------

# 37. Expiry Logic

For every certificate:

``` text
daysRemaining =
  certificate.validUntil - currentDate
```

Statuses:

``` text
> 30 days
Healthy

8–30 days
Expiring Soon

5–7 days
Warning

1–4 days
Critical

0 days
Expired
```

Mandatory notification:

``` text
<= 5 days
```

For domains use configurable thresholds.

------------------------------------------------------------------------

# 38. Health Check Frequency

Default:

``` text
Domain expiry:
Daily

SSL certificate:
Daily

Server health:
Every 5–15 minutes

DNS:
On demand + during ACME validation
```

Allow administrators to customize schedules.

------------------------------------------------------------------------

# 39. API Design

Suggested endpoints:

``` text
GET    /api/domains
POST   /api/domains
GET    /api/domains/:id
PATCH  /api/domains/:id
DELETE /api/domains/:id

POST   /api/domains/:id/verify
POST   /api/domains/:id/check-ssl

GET    /api/certificates
GET    /api/certificates/:id
POST   /api/certificates/request
POST   /api/certificates/:id/renew
POST   /api/certificates/:id/install
POST   /api/certificates/:id/verify
POST   /api/certificates/:id/rollback

GET    /api/servers
POST   /api/servers
PATCH  /api/servers/:id
DELETE /api/servers/:id
POST   /api/servers/:id/test
POST   /api/servers/:id/health

GET    /api/dns/providers
POST   /api/dns/providers
POST   /api/dns/providers/:id/test

GET    /api/notifications
PATCH  /api/notifications/settings

GET    /api/logs
GET    /api/reports
```

------------------------------------------------------------------------

# 40. API Rules

Every endpoint must:

1.  Authenticate user.
2.  Authorize user.
3.  Validate request.
4.  Perform operation.
5.  Record audit event where appropriate.
6.  Return sanitized response.
7.  Never expose secrets.

Do not allow user-supplied arbitrary commands.

------------------------------------------------------------------------

# 41. Error Handling

Every automated operation must return structured errors.

Example:

``` json
{
  "success": false,
  "code": "DNS_VALIDATION_FAILED",
  "message": "DNS challenge could not be verified.",
  "retryable": true
}
```

Useful error codes:

``` text
DOMAIN_NOT_FOUND
RDAP_UNAVAILABLE
SSL_CONNECTION_FAILED
SSL_EXPIRED
SSL_HOSTNAME_MISMATCH
SSL_CHAIN_INVALID
ACME_VALIDATION_FAILED
DNS_PROVIDER_ERROR
SSH_CONNECTION_FAILED
SERVER_PERMISSION_DENIED
NGINX_CONFIG_INVALID
APACHE_CONFIG_INVALID
CERTIFICATE_INSTALL_FAILED
ROLLBACK_FAILED
NOTIFICATION_FAILED
```

------------------------------------------------------------------------

# 42. UI Status System

Use consistent badges.

``` text
Healthy
green

Verified
green

Connected
green

Expiring Soon
amber

Warning
amber

Critical
red

Expired
red

Error
red

Offline
red

Running
blue

Manual Action
purple
```

Do not communicate critical failures using color alone. Always include
text/icon.

------------------------------------------------------------------------

# 43. Responsive Design

Desktop:

``` text
Sidebar 240px
Main content flexible
Max content width approximately 1440px
```

Tablet:

``` text
Collapsed sidebar
Responsive tables
Cards become 2-column
```

Mobile:

``` text
Drawer navigation
Single-column cards
Tables become cards or horizontal scroll
Sticky primary actions
```

The application must remain usable on mobile for checking alerts and
approving actions.

------------------------------------------------------------------------

# 44. Accessibility

Implement:

-   Semantic HTML.
-   Keyboard navigation.
-   Visible focus states.
-   Proper labels.
-   ARIA where required.
-   Accessible dialogs.
-   Accessible dropdowns.
-   Color contrast.
-   Screen-reader friendly status messages.
-   Do not use color as the only status indicator.

------------------------------------------------------------------------

# 45. Animation

Use Framer Motion sparingly.

Allowed:

``` text
Page fade-in
Card hover
Modal entrance
Sidebar transition
Status update
Loading skeleton
Progress indicators
```

Avoid:

``` text
Large parallax effects
Excessive bouncing
Continuous animations
Heavy 3D effects
```

This is a technical infrastructure product; speed and clarity are more
important than visual effects.

------------------------------------------------------------------------

# 46. Loading States

Every data-heavy page needs skeleton loading.

Examples:

``` text
Dashboard cards skeleton
Table skeleton
Certificate details skeleton
Server details skeleton
```

For long operations:

``` text
SSL Renewal

Step 1/6
Requesting certificate

✓ Domain validation
✓ DNS validation
● Issuing certificate
○ Installing
○ Testing
○ Verifying
```

------------------------------------------------------------------------

# 47. Confirmation Modals

Dangerous actions require confirmation.

Examples:

``` text
Delete Domain

This will remove monitoring and automation for example.com.

[Cancel]
[Delete Domain]
```

``` text
Install Certificate

The existing certificate will be backed up before installation.

Server:
Production Server 01

[Cancel]
[Install Certificate]
```

``` text
Rollback Certificate

This will restore the previous certificate and configuration.

[Cancel]
[Rollback]
```

------------------------------------------------------------------------

# 48. First-Run Bulk Scanner

Important feature.

Allow:

``` text
Scan Multiple Domains
```

Input:

``` text
example.com
example.ae
example.org
example.net
```

Process:

``` text
Scanning 4 domains...

example.com
✓ Domain
✓ SSL

example.ae
✓ Domain
⚠ SSL expires in 4 days

example.org
⚠ Domain expiry mismatch
✓ SSL

example.net
✓ Domain
❌ SSL hostname mismatch
```

Final result:

``` text
4 domains scanned

3 verified
2 warnings
1 critical

[Review Results]
```

------------------------------------------------------------------------

# 49. Domain Date Verification Rules

The UI must clearly distinguish:

``` text
Stored Date
Discovered Date
Verified Date
```

Never present an unverified date as authoritative.

Example:

``` text
Domain Expiry

Stored:
15 Jan 2027

RDAP:
15 Feb 2027

Registrar:
15 Feb 2027

Status:
Mismatch
```

Action:

``` text
[Use Discovered Date]
```

Record this action in audit logs.

------------------------------------------------------------------------

# 50. Certificate Date Verification

Use the live certificate as the primary SSL source.

Example:

``` text
Live Certificate:
30 Oct 2026

Stored:
30 Oct 2026

Status:
✓ Match
```

If different:

``` text
Live:
30 Oct 2026

Stored:
15 Oct 2026

⚠ Certificate changed

[Update Certificate Record]
```

Store certificate history.

------------------------------------------------------------------------

# 51. Automatic Installation Safety

Before installation:

``` text
1. Verify SSH
2. Verify domain mapping
3. Backup existing certificate
4. Backup relevant configuration
5. Upload certificate
6. Set permissions
7. Test configuration
8. Reload
9. Verify live HTTPS
```

If step 7 fails:

``` text
DO NOT RELOAD
ROLLBACK
```

If step 9 fails:

``` text
ROLLBACK
```

------------------------------------------------------------------------

# 52. Backup Strategy

Before every certificate deployment:

``` text
Certificate backup
Private key backup
Relevant web-server config backup
```

Backups should be encrypted and have retention settings.

Example:

``` text
Keep last 5 successful backups
```

Do not expose private key contents in the UI.

------------------------------------------------------------------------

# 53. Free SSL Strategy

Primary provider:

``` text
Let's Encrypt
```

Use ACME.

Support:

``` text
HTTP-01
DNS-01
```

Prefer DNS-01 for:

``` text
Wildcard certificates
Servers without public HTTP access
```

Automatic issuance should only occur when:

``` text
Domain ownership can be validated
DNS/server configuration is supported
Credentials are valid
```

------------------------------------------------------------------------

# 54. Registrar Integrations

Make registrar support modular.

Possible providers:

``` text
GoDaddy
Namecheap
Cloudflare Registrar
Porkbun
AWS Route53
```

Do not make the application depend on one registrar.

If registrar API is unavailable, use RDAP where possible and clearly
mark the source.

------------------------------------------------------------------------

# 55. Monitoring

Create system health indicators:

``` text
Database
Redis
Worker
Scheduler
Email
DNS APIs
ACME
Server connections
```

Settings/System page:

``` text
✓ PostgreSQL
✓ Redis
✓ Worker
✓ Scheduler
✓ Let's Encrypt
✓ Cloudflare
⚠ Email
```

------------------------------------------------------------------------

# 56. Logging

Application logs should contain:

``` text
timestamp
level
service
jobId
userId
domainId
serverId
message
metadata
```

Never log:

``` text
passwords
private keys
API tokens
full secrets
```

------------------------------------------------------------------------

# 57. Testing Requirements

Create automated tests for:

## Unit tests

``` text
Expiry calculations
Domain normalization
Hostname validation
Certificate parsing
SAN matching
Status calculation
Notification threshold calculation
```

## Integration tests

``` text
RDAP lookup
SSL inspection
DNS provider
ACME flow
SSH connection
Nginx config test
Notification provider
```

## End-to-end tests

Test:

``` text
Add domain
Verify domain
Inspect SSL
Detect expiry
Create notification
Request certificate
Install certificate
Verify live SSL
Rollback failed deployment
```

------------------------------------------------------------------------

# 58. Security Testing

Test:

``` text
Authentication bypass
Authorization bypass
IDOR
CSRF
XSS
SQL injection
SSRF
Command injection
Path traversal
Credential leakage
Secret exposure
Rate-limit bypass
```

Special attention must be given to SSRF because the application will
connect to user-configured domains and servers.

Restrict outbound connections where practical and validate targets.

------------------------------------------------------------------------

# 59. SSRF Protection

Because users can enter domains/hosts, implement protections against:

``` text
localhost
127.0.0.1
0.0.0.0
private IPv4 ranges
link-local addresses
metadata endpoints
internal DNS names
```

Use safe DNS resolution and re-check resolved IPs before making network
connections.

Do not allow arbitrary internal network probing.

------------------------------------------------------------------------

# 60. Deployment

Provide:

``` text
Dockerfile
docker-compose.yml
.env.example
README.md
Prisma migrations
Seed script
Production deployment documentation
```

Docker services:

``` text
web
worker
redis
postgres
```

Optional:

``` text
nginx
```

------------------------------------------------------------------------

# 61. Environment Variables

Example:

``` env
DATABASE_URL=
DIRECT_URL=

REDIS_URL=

NEXTAUTH_SECRET=
NEXTAUTH_URL=

ENCRYPTION_KEY=

ACME_EMAIL=

CLOUDFLARE_API_TOKEN=

SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASSWORD=

TELEGRAM_BOT_TOKEN=
SLACK_WEBHOOK_URL=
```

Never commit `.env`.

Provide `.env.example`.

------------------------------------------------------------------------

# 62. Authentication

Implement:

``` text
Email + Password
```

Future:

``` text
Google OAuth
Microsoft OAuth
SSO
```

Admin accounts should support 2FA.

Use secure session handling.

------------------------------------------------------------------------

# 63. Seed Data

Provide demo seed data:

``` text
example.com
example.ae
example.org
```

Demo servers:

``` text
Production Server 01
Staging Server
```

Demo certificate states:

``` text
Healthy
Expiring
Expired
Error
```

Clearly mark seed data as demo data.

------------------------------------------------------------------------

# 64. Important Product Rules

1.  Never trust stored expiry dates without verification.
2.  Never automatically overwrite dates without recording the source.
3.  Never expose private keys.
4.  Never execute arbitrary user-supplied shell commands.
5.  Never reload Nginx/Apache without configuration testing.
6.  Always backup before certificate installation.
7.  Always verify the live certificate after installation.
8.  Roll back when safe verification fails.
9.  Use background jobs for long-running operations.
10. Make automated operations idempotent.
11. Keep detailed audit logs.
12. Notify at least 5 days before expiry.
13. Prefer renewal before the 5-day critical window.
14. Make provider integrations modular.
15. Clearly distinguish automatic and manual operations.

------------------------------------------------------------------------

# 65. Suggested Project Structure

``` text
domain-ssl-manager/

├── apps/
│   ├── web/
│   │   ├── app/
│   │   │   ├── (auth)/
│   │   │   ├── dashboard/
│   │   │   ├── domains/
│   │   │   ├── certificates/
│   │   │   ├── servers/
│   │   │   ├── dns/
│   │   │   ├── notifications/
│   │   │   ├── logs/
│   │   │   ├── reports/
│   │   │   └── settings/
│   │   ├── components/
│   │   ├── hooks/
│   │   └── lib/
│   │
│   └── worker/
│       ├── jobs/
│       ├── queues/
│       ├── processors/
│       └── services/
│
├── packages/
│   ├── database/
│   ├── ssl-engine/
│   ├── domain-engine/
│   ├── ssh-manager/
│   ├── dns-providers/
│   ├── notification-engine/
│   └── security/
│
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
│
├── docker/
├── .env.example
├── docker-compose.yml
└── README.md
```

------------------------------------------------------------------------

# 66. Claude Implementation Instructions

You are acting as the lead full-stack engineer.

Do not only create mockups.

Build the actual working application.

## Development sequence

### Phase 1 --- Foundation

Implement:

``` text
Project setup
Authentication
Database
Prisma schema
UI shell
Sidebar
Header
Theme
RBAC
```

### Phase 2 --- Domains

Implement:

``` text
Domain CRUD
RDAP verification
Domain status
Expiry calculations
Bulk scanner
```

### Phase 3 --- SSL inspection

Implement:

``` text
Live certificate inspection
Certificate parsing
SAN verification
Certificate history
SSL status
```

### Phase 4 --- Servers

Implement:

``` text
Server CRUD
Encrypted credentials
SSH connectivity
Server health
Nginx
Apache
```

### Phase 5 --- ACME

Implement:

``` text
Let's Encrypt
HTTP-01
DNS-01
Cloudflare
Certificate issuance
Certificate renewal
```

### Phase 6 --- Deployment

Implement:

``` text
Certificate backup
Installation
Nginx config test
Apache config test
Reload
Live verification
Rollback
```

### Phase 7 --- Automation

Implement:

``` text
BullMQ
Redis
Schedulers
Daily checks
Renewal jobs
Notifications
Retries
Locks
```

### Phase 8 --- Reports & polish

Implement:

``` text
Reports
CSV export
Audit logs
System health
Responsive UI
Accessibility
Error states
Loading states
Empty states
```

------------------------------------------------------------------------

# 67. Definition of Done

The project is considered complete only when:

``` text
✓ User can log in
✓ User can create domains
✓ Domain expiry is externally verified
✓ SSL expiry is externally inspected
✓ Mismatched dates are clearly displayed
✓ User can edit domains
✓ User can delete domains
✓ User can add servers
✓ SSH connection can be tested
✓ User can request Let's Encrypt SSL
✓ HTTP-01 works
✓ DNS-01 works with Cloudflare
✓ Certificates can be renewed
✓ Certificates can be installed
✓ Nginx is supported
✓ Apache is supported
✓ Config is tested before reload
✓ Existing certificate is backed up
✓ Failed deployment can roll back
✓ Live SSL is verified after installation
✓ 5-day alert works
✓ Multiple notification thresholds work
✓ Email notifications work
✓ Automation logs are available
✓ Audit logs are available
✓ Credentials are encrypted
✓ Private keys are never exposed
✓ Arbitrary shell execution is impossible
✓ RBAC works
✓ Tests exist
✓ Docker deployment works
✓ Production documentation exists
```

------------------------------------------------------------------------

# 68. Final UI Quality Requirement

The generated UI must closely follow the high-fidelity concept supplied
with this specification.

The product should look like:

``` text
Enterprise SaaS
+
DevOps Infrastructure
+
Security Monitoring
+
Certificate Management
```

It should not look like:

``` text
Basic admin template
Cheap hosting panel
Generic CRUD application
```

Prioritize:

``` text
Clarity
Security
Trust
Status visibility
Automation visibility
Fast scanning
Actionable alerts
```

The most important information on every domain should always be:

``` text
DOMAIN EXPIRY
SSL EXPIRY
DAYS REMAINING
VERIFICATION STATUS
AUTOMATION STATUS
SERVER STATUS
```

------------------------------------------------------------------------

# 69. Final Product Flow

The final system should provide this complete experience:

``` text
                ADD DOMAIN
                    │
                    ▼
             DISCOVER DOMAIN
                    │
                    ▼
              RDAP / WHOIS
                    │
                    ▼
             VERIFY EXPIRY
                    │
                    ▼
             CHECK LIVE SSL
                    │
                    ▼
          COMPARE STORED DATA
                    │
             ┌──────┴──────┐
             ▼             ▼
          MATCH         MISMATCH
             │             │
             ▼             ▼
         VERIFIED       WARNING
             │
             ▼
       ENABLE MONITORING
             │
             ▼
        DAILY HEALTH CHECK
             │
       ┌─────┴─────────┐
       ▼               ▼
 DOMAIN EXPIRY      SSL EXPIRY
       │               │
       └──────┬────────┘
              ▼
         ALERT ENGINE
              │
        <= 5 DAYS?
          /       \
        NO         YES
        │           │
        ▼           ▼
      Monitor     ALERT
                    │
                    ▼
              AUTO RENEW?
               /       \
             NO         YES
             │           │
             ▼           ▼
           Alert      ACME
                        │
                        ▼
                    VALIDATE
                        │
                        ▼
                    ISSUE SSL
                        │
                        ▼
                 BACKUP CURRENT
                        │
                        ▼
                  INSTALL NEW SSL
                        │
                        ▼
                  TEST NGINX/APACHE
                        │
                  ┌─────┴─────┐
                  ▼           ▼
                PASS         FAIL
                  │           │
                  ▼           ▼
                RELOAD      ROLLBACK
                  │           │
                  ▼           ▼
             LIVE SSL CHECK  ALERT
                  │
                  ▼
                SUCCESS
                  │
                  ▼
             AUDIT LOG
```

Build this as a real production-grade application with clean
architecture, strong security boundaries, reusable provider interfaces,
background workers, automated testing, and a polished high-fidelity SaaS
interface.

Do not hard-code provider-specific behavior into the UI. Keep domain,
certificate, DNS, notification, and server integrations modular so
additional providers can be added without rewriting the core system.
