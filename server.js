// Express backend with endpoints for scheduling and reports
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(bodyParser.json());

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

const TIME_SLOTS = ["1pm", "2pm", "3pm", "4pm", "5pm"];
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

app.get('/api/campsites', async (req, res) => {
  const result = await pool.query('SELECT * FROM campsites');
  res.json(result.rows);
});

app.get('/api/activities', async (req, res) => {
  const result = await pool.query('SELECT * FROM activities');
  res.json(result.rows);
});

app.get('/api/staff', async (req, res) => {
  const result = await pool.query('SELECT * FROM staff');
  res.json(result.rows);
});

app.post('/api/schedule', async (req, res) => {
  const { week_id } = req.body;
  const [campsites, activities, prefs] = await Promise.all([
    pool.query('SELECT * FROM campsites'),
    pool.query('SELECT * FROM activities'),
    pool.query('SELECT * FROM preferences')
  ]);

  const schedules = [];
  let timeIndex = 0;

  for (let site of campsites.rows) {
    const sitePrefs = prefs.rows
      .filter(p => p.campsite_id === site.id)
      .sort((a, b) => a.rank - b.rank);

    for (let day of DAYS) {
      for (let pref of sitePrefs) {
        const activity = activities.rows.find(a => a.id === pref.activity_id);
        if (!activity) continue;
        const time_slot = TIME_SLOTS[timeIndex % TIME_SLOTS.length];
        schedules.push({
          campsite_id: site.id,
          activity_id: activity.id,
          area_id: activity.area_id,
          staff_id: null,
          day_of_week: day,
          time_slot,
          week_id,
          split_group: site.total_count > activity.capacity,
          overridden: false,
        });
        timeIndex++;
        break;
      }
    }
  }

  for (let sched of schedules) {
    await pool.query(
      'INSERT INTO schedules (campsite_id, activity_id, area_id, staff_id, day_of_week, time_slot, week_id, split_group, overridden) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [sched.campsite_id, sched.activity_id, sched.area_id, sched.staff_id, sched.day_of_week, sched.time_slot, sched.week_id, sched.split_group, sched.overridden]
    );
  }

  res.json({ status: 'scheduled', count: schedules.length });
});

app.get('/api/reports/area', async (req, res) => {
  const result = await pool.query(`
    SELECT area_id, day_of_week, time_slot, string_agg(DISTINCT a.name, ', ') AS activities,
           string_agg(DISTINCT s.name, ', ') AS staff
    FROM schedules
    LEFT JOIN activities a ON a.id = schedules.activity_id
    LEFT JOIN staff s ON s.assigned_area_id = schedules.area_id
    GROUP BY area_id, day_of_week, time_slot
    ORDER BY day_of_week, time_slot
  `);
  res.json(result.rows);
});

app.get('/api/reports/staff', async (req, res) => {
  const result = await pool.query(`
    SELECT s.name AS staff_name, day_of_week, time_slot, string_agg(a.name, ', ') AS activities
    FROM schedules
    LEFT JOIN staff s ON s.id = schedules.staff_id
    LEFT JOIN activities a ON a.id = schedules.activity_id
    WHERE schedules.staff_id IS NOT NULL
    GROUP BY s.name, day_of_week, time_slot
    ORDER BY s.name, day_of_week, time_slot
  `);
  res.json(result.rows);
});

app.get('/api/reports/campsite', async (req, res) => {
  const result = await pool.query(`
    SELECT c.name AS campsite_name, day_of_week, time_slot, a.name AS activity
    FROM schedules
    JOIN campsites c ON c.id = schedules.campsite_id
    JOIN activities a ON a.id = schedules.activity_id
    ORDER BY c.name, day_of_week, time_slot
  `);
  res.json(result.rows);
});

app.listen(5000, () => console.log('Server running on http://localhost:5000'));
