require('dotenv').config();
// Application Dependencies
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const pg = require('pg');
// Application Setup
const app = express();
app.use(express.json());
//read incoming json data
app.use(express.urlencoded({ extended: true }));
//parsing application
app.use(morgan('dev')); // http logging
app.use(cors()); // enable CORS request
app.use(express.static('public')); // server files from /public folder
const Client = pg.Client;
const client = new Client(process.env.DATABASE_URL);
client.connect();
//connect to database client
const PORT = process.env.PORT || 3000;
const request = require('superagent');

const TICKETMASTER_URL = 'https://app.ticketmaster.com/discovery/v2/events';


// Auth Routes
const createAuthRoutes = require('./lib/auth/create-auth-routes.js');
const authRoutes = createAuthRoutes({
    selectUser(email) {
        return client.query(`
            SELECT id, email, hash 
            FROM users
            WHERE email = $1;
        `,
        [email]
        ).then(result => result.rows[0]);
    },
    insertUser(user, hash, displayname, city, lat, long) {
        console.log(city)
        return client.query(`
            INSERT into users (email, hash, display_name, city_name, lat, long)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *;
        `,
        [user.email, hash, displayname, city, lat, long]
        ).then(result => result.rows[0]);
    }
});

// before ensure auth, but after other middleware:
app.use('/api/auth', authRoutes);
// for every route, on every request, make sure there is a token
const ensureAuth = require('./lib/auth/ensure-auth.js');
app.use('/api/me', ensureAuth);

app.get('/api/concerts', async(req, res) => {
    const keyword = req.query.keyword ? req.query.keyword : '';
    const city = req.query.city ? req.query.city : '';
    console.log(req.query);
    const data = await request.get(`${TICKETMASTER_URL}.json?countryCode=US&keyword=${keyword}&apikey=${process.env.TICKETMASTER_KEY}&sort=date,asc&city=${city}&classificationName=Music`);
    res.json(data.body);
});

app.get('/api/concerts/:id', async(req, res) => {
    const data = await request.get(`${TICKETMASTER_URL}/${req.params.id}?apikey=${process.env.TICKETMASTER_KEY}`);
    res.json(data.body);
});
let lat;
let long;

app.get('/location', async(req, respond, next) => {
    try {
        const location = req.query.search;
        const URL = `https://us1.locationiq.com/v1/search.php?key=${process.env.GEOCODE_API_KEY}&q=${location}&format=json`;
        const cityData = await request.get(URL);
        const firstResult = cityData.body[0];
        // update the global state of lat and long so that it is acceptable in other routes
        lat = firstResult.lat;
        long = firstResult.lon;
        respond.json({
            formatted_query: firstResult.display_name,
            latitude: lat,
            longitude: long
        });
    } catch (err) {
        next(err);
    }
});


const getConcertData = async(lat, long) => {
    const concertData = await request.get(`${TICKETMASTER_URL}.json?countryCode=US&keyword=concert&apikey=${process.env.TICKETMASTER_KEY}/${lat},${long}`);
    return concertData.body.daily.data.map(concert => {
        return {
            name: concert.name,
        };
    });
} ;
app.get('/concert', async(req, res, next) => {
    try {
        const concerts = await getConcertData(lat, lng);
        res.json(concerts);
    } catch (err) {
        next(err);
    }
});
app.get('/api/me/saved', async(req, res) => {
    try {
        const saved = await client.query(`
        SELECT * FROM saved
        WHERE user_id = $1
        ORDER BY id;
        `,
        [req.userId]
        );
        res.json(saved.rows);
    }
    catch (err){
        console.log(err);
    }
});

app.post('/api/me/saved', async(req, res) => {
    try {
        console.log(req.body);
        const newSaved = await client.query(`
            INSERT into saved (user_id, name, images, genre, start_date, tickets_url, city, state, price_min, price_max, lat, long, tm_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING *;
        `,
        [req.userId,
            req.body.name,
            req.body.images,
            req.body.genre,
            req.body.start_date,
            req.body.tickets_url,
            req.body.city,
            req.body.state,
            req.body.price_min,
            req.body.price_max,
            req.body.longitude,
            req.body.latitude,
            req.body.tm_id,
        ]);
        res.json(newSaved.rows[0]);
    }
    catch (err) {
        console.log(err);
        if (err.constraint === 'saved_user_id_tm_id_key') { res.send('Already in saved!'); }
        res.status(500).json({
            error: err.message || err
        });
    }
});

app.delete('/api/me/saved/:id', async(req, res) => {
    // get the id that was passed in the route:
    try {
        const saved = await client.query(`
            DELETE FROM saved
            WHERE id = $1
            RETURNING *;
        `, [req.params.id]);
        res.json(saved.rows[0]);
    }
    catch (err) {
        console.log(err);
        res.status(500).json({
            error: err.message || err
        });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log('server running on PORT', PORT);
});