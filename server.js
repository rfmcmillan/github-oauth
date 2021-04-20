try {
  const env = require('./env');
  process.env.client_id = env.client_id;
  process.env.client_secret = env.client_secret;
} catch (error) {
  console.log(error);
  console.log('YOU NEED ENVIRONMENT VARIABLES');
}

const Sequelize = require('sequelize');
const {
  DataTypes: { STRING, UUID, UUIDV4, JSON },
} = Sequelize;
const db = new Sequelize(
  process.env.DATABASE_URL || 'postgres://localhost/acme_db'
);

const User = db.define('user', {
  id: {
    primaryKey: true,
    type: UUID,
    defaultValue: UUIDV4,
  },
  username: { type: STRING, allowNull: false, unique: true },
  github: {
    type: JSON,
  },
});

const axios = require('axios');
//simple render engine so that you can use res.render below
const ejs = require('ejs');
const express = require('express');
const path = require('path');
const app = express();
const jwt = require('jsonwebtoken');
//set the render engine for html files to ejs's renderFile; it also allows us to
//render the index.html file with the data that is passed in within the res.render
//i.e. {client_id: process.env.client_id}
//it gives functionality that is similar to a template literal but applies to providing data through a url
//see the index.html file or documentation for syntax
app.engine('html', ejs.renderFile);

app.get('/', (req, res, next) =>
  res.render(path.join(__dirname, './index.html'), {
    client_id: process.env.client_id,
  })
);

app.get('/api/auth', async (req, res, next) => {
  try {
    const { id } = await jwt.verify(req.headers.authorization, process.env.JWT);
    const user = await User.findByPk(id);
    if (!user) {
      const error = Error('bad credentials');
      error.status = 401;
      throw error;
    }
    res.send(user);
  } catch (error) {
    next(error);
  }
});

app.get('/callback', async (req, res, next) => {
  try {
    let response = await axios.post(
      'https://github.com/login/oauth/access_token',
      {
        code: req.query.code,
        client_id: process.env.client_id,
        client_secret: process.env.client_secret,
      },
      {
        headers: {
          accept: 'application/json',
        },
      }
    );
    const data = response.data;
    if (data.error) {
      const error = Error(data.error);
      error.status = 401;
      throw error;
    }
    response = await axios.get('https://api.github.com/user', {
      headers: {
        authorization: `token ${data.access_token}`,
      },
    });
    const { login, ...github } = response.data;
    let user = await User.findOne({
      where: {
        username: login,
      },
    });
    if (!user) {
      user = await User.create({ username: login, github });
    } else {
      await user.update({ github });
      //should there be a user.save() here to save the update? not sure; prof didn't have one
    }
    const jwtToken = jwt.sign({ id: user.id }, process.env.JWT);
    console.log(`jwtToken: ${jwtToken}`);
    //window.document.location below will cause a redirect to the homepage
    //in Chrome's console you can check if localStorage is storing your data by typing 'window.localStorage.getItem'
    res.send(`
      <html>
        <head>
          <script>
            window.localStorage.setItem('token', '${jwtToken}')
            window.document.location = '/';
          </script>
        </head>
      </html>
    `);
  } catch (error) {
    next(error);
  }
});

app.use((err, req, res, next) => {
  console.log(err);
  res.status(err.status).send({ error: err.message });
});

const init = async () => {
  try {
    await db.sync({ force: true });
    const port = process.env.PORT || 3000;
    app.listen(port, console.log(`listening on port:${port}`));
  } catch (error) {
    console.log(error);
  }
};

init();
