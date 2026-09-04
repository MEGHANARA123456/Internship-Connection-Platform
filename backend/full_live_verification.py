"""
Full Live Verification Script for Internship Connection Platform
Runs the complete user journey end-to-end against live Docker containers.
"""
import urllib.request
import urllib.error
import json
import time
import os

BASE = "http://localhost:8000/api/v1"
MAILPIT = "http://mailpit:8025/api/v1"

def req(url, method="GET", data=None, token=None, content_type="application/json"):
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    body = None
    if data is not None:
        if content_type == "application/json":
            body = json.dumps(data).encode("utf-8")
            headers["Content-Type"] = "application/json"
        else:
            body = data
            headers["Content-Type"] = content_type

    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request) as resp:
            resp_body = resp.read()
            try:
                parsed = json.loads(resp_body.decode("utf-8"))
            except Exception:
                parsed = resp_body
            return resp.status, parsed
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8")
        try:
            parsed = json.loads(err_body)
        except Exception:
            parsed = err_body
        return e.code, parsed

def run():
    results = {}
    ts = int(time.time())

    print("=== 1. Student Registration & Email Verification ===")
    st_email = f"student_e2e_{ts}@university.edu"
    st_reg_data = {
        "email": st_email,
        "password": "Password123!",
        "full_name": "Jane Doe",
        "university": "Stanford University",
        "major": "Computer Science",
        "graduation_year": 2026,
        "skills": "Python, React, TypeScript, FastAPI",
        "bio": "Passionate software engineering student."
    }
    status, body = req(f"{BASE}/auth/register/student", "POST", st_reg_data)
    print(f"Student register: {status} -> {body}")
    assert status == 201, f"Expected 201, got {status}: {body}"
    st_user_id = body["id"]
    results["student_registered"] = body

    time.sleep(1)
    # Check Mailpit for student verification token
    status, mail_body = req(f"{MAILPIT}/messages")
    assert status == 200
    st_msg = None
    for msg in mail_body.get("messages", []):
        if msg["To"][0]["Address"] == st_email:
            st_msg = msg
            break
    assert st_msg is not None, f"No verification email found for {st_email}"
    print(f"Mailpit message found: '{st_msg['Subject']}' for {st_email}")
    results["student_mailpit_delivered"] = st_msg["Subject"]

    # Fetch email body to get token
    status, msg_detail = req(f"{MAILPIT}/message/{st_msg['ID']}")
    raw_text = msg_detail.get("Text", "")
    import re
    token_match = re.search(r"Verification token:\s*([^\s\r\n]+)", raw_text)
    assert token_match, f"Token not found in email body: {raw_text}"
    st_verify_token = token_match.group(1).strip()

    # Verify email
    status, verify_res = req(f"{BASE}/auth/verify/{st_verify_token}")
    print(f"Student email verify: {status} -> {verify_res}")
    assert status == 200

    # Student Login
    status, st_login = req(f"{BASE}/auth/login", "POST", {"email": st_email, "password": "Password123!"})
    print(f"Student login: {status} -> user_id={st_login.get('user_id')}, role={st_login.get('role')}")
    assert status == 200
    assert st_login.get("user_id") == st_user_id
    st_token = st_login["access_token"]
    results["student_logged_in"] = {"user_id": st_user_id, "role": st_login.get("role")}

    print("\n=== 2. Student Profile & Resume Upload ===")
    # Update profile
    status, prof_res = req(f"{BASE}/profiles/student", "PUT", {
        "full_name": "Jane Doe",
        "university": "Stanford University",
        "major": "Computer Science",
        "graduation_year": 2026,
        "skills": "Python, React, TypeScript, FastAPI, PostgreSQL",
        "bio": "Top honors student seeking backend or full-stack internships."
    }, token=st_token)
    assert status == 200
    assert "PostgreSQL" in prof_res["skills"]
    print(f"Profile updated: {prof_res['skills']}")

    # Upload PDF Resume
    pdf_bytes = b"%PDF-1.4\n1 0 obj\n<< /Title (Jane Doe Resume) >>\nendobj\ntrailer\n<< >>\n%%EOF"
    boundary = "----WebKitFormBoundaryE2eTest7MA4YWxk"
    body_data = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="jane_doe_resume.pdf"\r\n'
        f"Content-Type: application/pdf\r\n\r\n"
    ).encode("utf-8") + pdf_bytes + f"\r\n--{boundary}--\r\n".encode("utf-8")

    status, resume_res = req(
        f"{BASE}/profiles/student/resume",
        "POST",
        data=body_data,
        token=st_token,
        content_type=f"multipart/form-data; boundary={boundary}"
    )
    print(f"Resume upload: {status} -> {resume_res}")
    assert status == 200 or status == 201
    resume_id = resume_res["id"]

    # Verify resume endpoint
    status, my_resume = req(f"{BASE}/profiles/student/resume", token=st_token)
    print(f"Get student resume: {status} -> {my_resume}")
    assert status == 200
    assert my_resume["id"] == resume_id
    results["student_resume_verified"] = my_resume

    # Download resume
    status, dl_bytes = req(f"{BASE}/profiles/resume/{resume_id}/download", token=st_token)
    assert status == 200
    assert b"%PDF-1.4" in dl_bytes
    print(f"Resume download verified: {len(dl_bytes)} bytes downloaded")

    print("\n=== 3. Company Registration, Email & Admin Verification ===")
    co_email = f"recruiter_e2e_{ts}@nextgen.tech"
    status, co_reg = req(f"{BASE}/auth/register/company", "POST", {
        "email": co_email,
        "password": "Password123!",
        "company_name": "NextGen Technologies",
        "industry": "Artificial Intelligence",
        "website": "https://nextgen.tech",
        "description": "Building modern agentic AI infrastructure."
    })
    print(f"Company register: {status} -> {co_reg}")
    assert status == 201
    co_user_id = co_reg["id"]

    # Verify company email
    time.sleep(1)
    status, mail_body = req(f"{MAILPIT}/messages")
    co_msg = None
    for msg in mail_body.get("messages", []):
        if msg["To"][0]["Address"] == co_email:
            co_msg = msg
            break
    assert co_msg is not None
    status, co_detail = req(f"{MAILPIT}/message/{co_msg['ID']}")
    token_match = re.search(r"Verification token:\s*([^\s\r\n]+)", co_detail.get("Text", ""))
    assert token_match
    req(f"{BASE}/auth/verify/{token_match.group(1).strip()}")

    # Provision fresh Admin & verify company
    admin_email = f"admin_e2e_{ts}@platform.internal"
    status, admin_reg = req(f"{BASE}/auth/register/admin", "POST", {
        "email": admin_email,
        "password": "Password123!",
        "signup_key": "change-admin-signup-key"
    })
    print(f"Admin registered: {status} -> {admin_reg}")
    assert status == 201

    status, admin_login = req(f"{BASE}/auth/login", "POST", {
        "email": admin_email,
        "password": "Password123!"
    })
    assert status == 200
    admin_token = admin_login["access_token"]

    status, verif_res = req(
        f"{BASE}/admin/companies/{co_user_id}/verification",
        "POST",
        {"status": "VERIFIED"},
        token=admin_token
    )
    print(f"Admin verify company: {status} -> {verif_res}")
    assert status == 200
    assert verif_res["verification_status"] == "VERIFIED"
    results["company_verified"] = verif_res

    # Company login
    status, co_login = req(f"{BASE}/auth/login", "POST", {"email": co_email, "password": "Password123!"})
    assert status == 200
    co_token = co_login["access_token"]

    print("\n=== 4. Job Posting Lifecycle & Moderation ===")
    status, job_res = req(f"{BASE}/internships", "POST", {
        "title": "AI Full Stack Intern",
        "description": "Collaborate on LLM interfaces, FastAPI microservices, and React frontends.",
        "location": "San Francisco, CA / Remote",
        "industry": "Artificial Intelligence",
        "duration_months": 4,
        "stipend": 4500,
        "work_mode": "HYBRID",
        "deadline": "2026-12-31",
        "skills": ["Python", "React", "TypeScript", "FastAPI"]
    }, token=co_token)
    print(f"Company created job (DRAFT): {status} -> ID={job_res['id']}")
    assert status == 201
    assert job_res["status"] == "DRAFT"
    job_id = job_res["id"]

    # Submit for approval
    status, submit_res = req(f"{BASE}/internships/{job_id}/submit", "POST", token=co_token)
    print(f"Company submitted job: {status} -> {submit_res['status']}")
    assert status == 200
    assert submit_res["status"] == "PENDING_APPROVAL"

    # Admin approves & publishes
    status, mod_res = req(
        f"{BASE}/admin/internships/{job_id}/moderation",
        "POST",
        {"status": "PUBLISHED"},
        token=admin_token
    )
    print(f"Admin approved job: {status} -> {mod_res['status']}")
    assert status == 200
    assert mod_res["status"] == "PUBLISHED"
    results["job_published"] = mod_res

    print("\n=== 5. Student Discovers & Applies ===")
    status, browse_res = req(f"{BASE}/internships?skills=Python", token=st_token)
    print(f"Student search results: {browse_res['total']} jobs found")
    assert status == 200
    assert any(j["id"] == job_id for j in browse_res["items"])

    # Student applies
    status, apply_res = req(
        f"{BASE}/applications/internships/{job_id}",
        "POST",
        {"cover_note": "I have extensive experience building FastAPI backends with React."},
        token=st_token
    )
    print(f"Student applied: {status} -> {apply_res}")
    assert status == 201
    assert apply_res["status"] == "APPLIED"
    app_id = apply_res["id"]
    results["application_submitted"] = apply_res

    print("\n=== 6. Company Pipeline & Interview Scheduling ===")
    # Company reviews applicants
    status, apps_list = req(f"{BASE}/applications/internships/{job_id}", token=co_token)
    assert status == 200
    assert any(a["id"] == app_id for a in apps_list)

    # Advance to UNDER_REVIEW
    status, rev_res = req(f"{BASE}/applications/{app_id}/review", "PATCH", token=co_token)
    print(f"Mark under review: {status} -> {rev_res['status']}")
    assert status == 200
    assert rev_res["status"] == "UNDER_REVIEW"

    # Shortlist candidate
    status, short_res = req(f"{BASE}/applications/{app_id}/shortlist", "PATCH", token=co_token)
    print(f"Shortlist candidate: {status} -> {short_res['status']}")
    assert status == 200
    assert short_res["status"] == "SHORTLISTED"

    # Schedule Interview
    scheduled_time = "2026-09-15T14:00:00Z"
    status, intv_res = req(f"{BASE}/applications/{app_id}/interviews", "POST", {
        "scheduled_at": scheduled_time,
        "interview_type": "VIDEO",
        "meeting_link": "https://meet.google.com/e2e-live-test",
        "notes": "System design and live code pairing."
    }, token=co_token)
    print(f"Schedule interview: {status} -> {intv_res}")
    assert status == 201
    assert intv_res["status"] == "SCHEDULED"
    interview_id = intv_res["id"]
    results["interview_scheduled"] = intv_res

    # Verify application status advanced to INTERVIEW_SCHEDULED
    status, app_check = req(f"{BASE}/applications/student", token=st_token)
    apps_list = app_check.get("applications", app_check if isinstance(app_check, list) else [])
    my_app = next(a for a in apps_list if a["id"] == app_id)
    print(f"Student sees updated application status: {my_app['status']}")
    assert my_app["status"] == "INTERVIEW_SCHEDULED"

    # Company Selects Candidate
    status, select_res = req(f"{BASE}/applications/{app_id}/select", "PATCH", token=co_token)
    print(f"Select candidate: {status} -> {select_res['status']}")
    assert status == 200
    assert select_res["status"] == "SELECTED"
    results["candidate_selected"] = select_res

    print("\n=== 7. Direct Messaging Between Student & Company ===")
    # Student starts conversation with company
    status, conv_res = req(f"{BASE}/conversations", "POST", {
        "participant_id": co_user_id
    }, token=st_token)
    print(f"Conversation established: {status} -> ID={conv_res['id']}")
    assert status == 201
    conv_id = conv_res["id"]

    # Student sends message
    status, msg1 = req(f"{BASE}/conversations/{conv_id}/messages", "POST", {
        "body": "Hello! Thank you for the interview invitation and selection offer."
    }, token=st_token)
    assert status == 201
    assert msg1["sender_id"] == st_user_id

    # Company replies
    status, msg2 = req(f"{BASE}/conversations/{conv_id}/messages", "POST", {
        "body": "Welcome aboard Jane! Excited to have you on the team."
    }, token=co_token)
    assert status == 201
    assert msg2["sender_id"] == co_user_id

    # Verify message thread
    status, thread = req(f"{BASE}/conversations/{conv_id}/messages", token=st_token)
    assert len(thread) >= 2
    print(f"Message thread verified: {len(thread)} messages exchanged.")
    results["messaging_verified"] = len(thread)

    print("\n=== 8. Dispute Reporting & Admin Resolution ===")
    status, report_res = req(f"{BASE}/reports", "POST", {
        "reason": "Sample test report for compliance audit validation.",
        "internship_id": job_id
    }, token=st_token)
    print(f"Student report submitted: {status} -> ID={report_res['id']}")
    assert status == 201
    report_id = report_res["id"]

    # Admin investigates report
    status, inv_res = req(f"{BASE}/admin/reports/{report_id}", "PATCH", {
        "status": "INVESTIGATING"
    }, token=admin_token)
    assert status == 200
    assert inv_res["status"] == "INVESTIGATING"

    # Admin resolves report
    status, res_res = req(f"{BASE}/admin/reports/{report_id}", "PATCH", {
        "status": "RESOLVED",
        "resolution_notes": "Reviewed posting compliance with recruiter and closed audit."
    }, token=admin_token)
    print(f"Admin resolved report: {status} -> {res_res['status']}")
    assert status == 200
    assert res_res["status"] == "RESOLVED"
    results["dispute_resolved"] = res_res

    print("\n=== ALL 8 STAGES OF LIVE RECRUITMENT JOURNEY COMPLETED & VERIFIED ===")
    return results

if __name__ == "__main__":
    res = run()
    with open("/app/full_verification_evidence.json", "w") as f:
        json.dump(res, f, indent=2, default=str)
    print("Verification evidence written to /app/full_verification_evidence.json")
