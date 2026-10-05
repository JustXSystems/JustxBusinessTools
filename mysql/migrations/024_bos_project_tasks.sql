-- Justx BOS project tasks and milestones (Projects → Tasks). Additive only (new bos_* tables).

-- status: open | done. done_on is the day it was marked done.
CREATE TABLE IF NOT EXISTS bos_project_milestones (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  project_id CHAR(36) NOT NULL,
  name VARCHAR(160) NOT NULL,
  due_on DATE NULL,
  status VARCHAR(8) NOT NULL DEFAULT 'open',
  done_on DATE NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bos_project_milestones_project (tenant_id, project_id, due_on),
  CONSTRAINT fk_bos_project_milestones_project FOREIGN KEY (project_id) REFERENCES bos_projects (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- task_no: TSK-0001… per tenant. project_id is optional (a personal or team to-do).
-- status: todo | in_progress | on_hold | done | cancelled. priority: low | normal | high | urgent.
-- recurrence: none | daily (working days) | weekly | monthly. A repeating task needs a due date. Marking it done adds
-- the next occurrence (next_task_id), and reopening removes that one again while it hasn't been started.
-- due_day keeps a monthly task on its day of the month (31 Jan → 28 Feb → 31 Mar).
CREATE TABLE IF NOT EXISTS bos_project_tasks (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  task_no VARCHAR(20) NOT NULL,
  project_id CHAR(36) NULL,
  milestone_id CHAR(36) NULL,
  title VARCHAR(200) NOT NULL,
  details TEXT NULL,
  assignee_employee_id CHAR(36) NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'todo',
  priority VARCHAR(8) NOT NULL DEFAULT 'normal',
  start_on DATE NULL,
  due_on DATE NULL,
  recurrence VARCHAR(8) NOT NULL DEFAULT 'none',
  due_day TINYINT UNSIGNED NULL,
  done_at TIMESTAMP NULL,
  done_by_name VARCHAR(120) NULL,
  next_task_id CHAR(36) NULL,
  created_by INT UNSIGNED NULL,
  created_by_name VARCHAR(120) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bos_project_tasks_no (tenant_id, task_no),
  KEY idx_bos_project_tasks_status (tenant_id, status, due_on),
  KEY idx_bos_project_tasks_project (tenant_id, project_id, status),
  KEY idx_bos_project_tasks_assignee (tenant_id, assignee_employee_id, status),
  KEY idx_bos_project_tasks_milestone (milestone_id),
  CONSTRAINT fk_bos_project_tasks_project FOREIGN KEY (project_id) REFERENCES bos_projects (id) ON DELETE CASCADE,
  CONSTRAINT fk_bos_project_tasks_milestone FOREIGN KEY (milestone_id) REFERENCES bos_project_milestones (id) ON DELETE SET NULL,
  CONSTRAINT fk_bos_project_tasks_assignee FOREIGN KEY (assignee_employee_id) REFERENCES bos_employees (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
