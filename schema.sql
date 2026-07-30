-- ============================================================
-- DentPilot Admin — مخطّط قاعدة البيانات (Supabase / PostgreSQL)
-- شغّل هذا الملف كاملاً في: Supabase Dashboard > SQL Editor > New query
-- ============================================================

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- المستخدمون: المالك (super_admin) والوكلاء (agent)
-- ------------------------------------------------------------
create table if not exists public.users (
  id            uuid primary key default gen_random_uuid(),
  role          text not null check (role in ('super_admin','agent')),
  name          text not null,
  username      text not null unique,
  phone         text,
  password_hash text not null,
  password_salt text not null,
  daily_limit   integer,                       -- للوكلاء؛ null للمالك (بلا حد)
  active        boolean not null default true,
  last_active_at timestamptz,
  agent_token   text unique,                   -- رمز رابط دعوة الوكيل الدائم (AGT_...)؛ null للمالك
  created_at    timestamptz not null default now()
);

-- ترقية آمنة لمشروع Supabase تم إعداده قبل إضافة رابط دعوة الوكيل:
-- إعادة تشغيل هذا الملف بالكامل على مشروع قائم لا يحذف أي بيانات، ويضيف العمود فقط إن كان ناقصاً.
alter table public.users add column if not exists agent_token text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'users_agent_token_key') then
    alter table public.users add constraint users_agent_token_key unique (agent_token);
  end if;
end $$;

create index if not exists users_role_idx on public.users (role);
create index if not exists users_username_idx on public.users (lower(username));
create index if not exists users_agent_token_idx on public.users (agent_token);

-- ------------------------------------------------------------
-- الأكواد: كل عملية توليد كود تفعيل (سجلّ + تدقيق)
-- ------------------------------------------------------------
create table if not exists public.codes (
  id              uuid primary key default gen_random_uuid(),
  code            text not null,               -- كود التفعيل XXXX-XXXX-XXXX-XXXX
  device_id       text not null,               -- معرّف الجهاز كما أُدخل (بأحرف كبيرة)
  device_id_norm  text not null,               -- معرّف مُطبَّع (بلا رموز) للتجميع
  app             text not null check (app in ('student','clinic')),
  duration        text not null default 'lifetime',
  agent_id        uuid references public.users(id) on delete set null,
  agent_name      text,                        -- لقطة اسم المُنشئ
  status          text not null default 'active' check (status in ('active','revoked')),
  created_at      timestamptz not null default now()
);

create index if not exists codes_agent_idx   on public.codes (agent_id);
create index if not exists codes_created_idx on public.codes (created_at);
create index if not exists codes_device_idx  on public.codes (device_id_norm, app);

-- ------------------------------------------------------------
-- أمان صفوف (RLS): نمنع أي وصول عبر مفتاح anon العام.
-- كل الوصول يتم من دوال الخادم بمفتاح service_role الذي يتجاوز RLS.
-- بتفعيل RLS بلا سياسات، يصبح anon محجوباً تماماً.
-- ------------------------------------------------------------
alter table public.users enable row level security;
alter table public.codes enable row level security;

-- (لا نضيف أي policy لـ anon/authenticated — الحجب هو السلوك الافتراضي)

-- ============================================================
-- تم. الآن أضف SUPABASE_URL و SUPABASE_SERVICE_KEY في متغيّرات البيئة.
-- ملاحظة: للوكلاء الذين أُنشئوا قبل هذا التحديث ولا يملكون رابط دخول بعد،
-- استخدم زر «توليد رابط» في لوحة الإدارة (قسم الوكلاء) لإصدار أول رابط لهم.
-- ============================================================


-- ============================================================
-- توسعة: الخطط + التفعيلات المباشرة + سجل عمليات الإدارة (إضافية، لا تمسّ ما سبق)
-- ============================================================

-- خطط الاشتراك (ديناميكية من لوحة التحكم)
create table if not exists public.plans (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  days       integer,                 -- عدد الأيام؛ null = مدى الحياة (بلا انتهاء)
  active     boolean not null default true,
  sort       integer not null default 0,
  created_at timestamptz not null default now()
);

-- سجلّات التفعيل المباشر (مصدر الحقيقة لحالة الجهاز في اللوحة)
create table if not exists public.device_activations (
  id             uuid primary key default gen_random_uuid(),
  device_id      text not null,
  device_id_norm text not null,
  app            text not null check (app in ('student','clinic')),
  plan_id        uuid references public.plans(id) on delete set null,
  plan_name      text,
  status         text not null default 'active' check (status in ('trial','active','expired','suspended')),
  start_at       timestamptz,
  end_at         timestamptz,          -- null = بلا انتهاء (مدى الحياة)
  source         text not null default 'direct' check (source in ('direct','code')),
  code           text,                 -- الكود المربوط بالجهاز (متوافق مع النظام الحالي)
  actor_id       uuid,
  actor_name     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (device_id_norm, app)
);
create index if not exists device_activations_dev_idx on public.device_activations (device_id_norm, app);
create index if not exists device_activations_code_idx on public.device_activations (code);

-- سجل عمليات الإدارة (تدقيق)
create table if not exists public.admin_log (
  id         uuid primary key default gen_random_uuid(),
  action     text not null,           -- activate | extend | change_plan | suspend | reactivate | plan_create ...
  device_id  text,
  app        text,
  plan_name  text,
  details    text,
  actor_id   uuid,
  actor_name text,
  created_at timestamptz not null default now()
);
create index if not exists admin_log_created_idx on public.admin_log (created_at);

-- RLS للجداول الجديدة (محجوبة عن anon، الخادم يصل بمفتاح service_role)
alter table public.plans enable row level security;
alter table public.device_activations enable row level security;
alter table public.admin_log enable row level security;

-- خطط افتراضية (تُدرَج مرّة واحدة فقط إن كان الجدول فارغاً)
insert into public.plans (name, days, active, sort)
select * from (values
  ('شهري', 30, true, 1),
  ('3 أشهر', 90, true, 2),
  ('6 أشهر', 180, true, 3),
  ('سنوي', 365, true, 4),
  ('مدى الحياة', null::int, true, 5)
) as v(name, days, active, sort)
where not exists (select 1 from public.plans);

-- ============================================================
-- انتهت التوسعة.
-- ============================================================
