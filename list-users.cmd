@echo off
rem Double-click to see everyone who has signed up (test accounts at example.com are hidden). Needs Docker running.
cd /d "%~dp0"
docker compose exec -T postgres psql -U system_self -d system_self -c "select username, email, case when email_verified_at is null then 'no' else 'yes' end as verified, to_char(created_at at time zone 'Asia/Kolkata','YYYY-MM-DD HH24:MI') as signed_up_ist, (select to_char(max(l.created_at) at time zone 'Asia/Kolkata','YYYY-MM-DD HH24:MI') from logs l where l.user_id = u.id) as last_log_ist from users u where email not like '%%@example.com' order by created_at;"
pause
