# Game-Night-Hub-Specification
## TL; DR
After a room of battlesnake is started, the hub runs the battlesnake docker image and passes room_uuid = "2743318a-41e2-4d56-bdbb-0035184d24fd" as an environment variable.

```python
import requests

response = requests.post(
    "http://localhost:8000/api/initialized/battlesnake",
    json={
        "room_uuid": "2743318a-41e2-4d56-bdbb-0035184d24fd",
        "config": {}
    },
)
```

The hub responses
```python
print(response.status_code) # 200
```
```json
# response.json()
{
  "ea0a1a11-56ae-4042-9547-eb1bf4757f70": {
    "name": "Alice",
    "difficulty": "player"
  },
  "01f7113e-f768-4bf4-ab58-f21483ca5cd7": {
    "name": "Bob",
    "difficulty": "player"
  },
  "26c33971-dd38-4a84-aa8c-480734ffbad1": {
    "name": "Bot",
    "difficulty": "normal"
  },
  "config": {}
}
```

The game configures its match to 3 players and notifies the hub.

```python
response = requests.post(
    "http://localhost:8000/api/start/battlesnake",
    json={
        "room_uuid": "2743318a-41e2-4d56-bdbb-0035184d24fd",
        "ea0a1a11-56ae-4042-9547-eb1bf4757f70": {
            "controller_link": "http://localhost:8000/xxx"
        },
        "01f7113e-f768-4bf4-ab58-f21483ca5cd7": {
            "controller_link": "http://localhost:8000/xxx2"
        },
        # Even if the bot may not need a controller link,
        # the field must still be set to some value.
        "26c33971-dd38-4a84-aa8c-480734ffbad1": {
            "controller_link": ""
        },
        "config": {}
    }
)
```
The hub reponse is ignored and match starts.

After the game finished, it reports the result to hub and quits.

```python
requests.post(
    "http://localhost:8000/api/result/battlesnake",
    json={
        "room_uuid": "2743318a-41e2-4d56-bdbb-0035184d24fd",
        "ea0a1a11-56ae-4042-9547-eb1bf4757f70": {
            # Depend on the game developer's specification
            "length": 32,
            "points": 100,
        },
        "01f7113e-f768-4bf4-ab58-f21483ca5cd7": {
            "length": 2,
            "points": 50,
        },
        "26c33971-dd38-4a84-aa8c-480734ffbad1": {
            "length": 8,
            "points": 25,
        },
        "config": {}
    }
)
```
## The lifecycle of a game
### Startup
The game is running in a docker container, so you can use any dependencies you need. The hub automatically runs the docker image and starts the game process. A special room uuid is passed to the game process via environment variables, and it will be used in later requests.
You can get the room uuid by
```python
import os
room_uuid: str = os.getenv("ROOM_UUID")
```
The game developer should left an entry point to run the game via command. When the game process is initialized, it requests the /api/initialized/{game-name} to notify the hub.

POST /api/initialized/{game-name}

Content-Type: application/json
```json
{
  # Example only. Replace this with the actual room_uuid.
  "room_uuid": "4349d563-8ab1-4113-a8ab-e81ca99d7711"
  "config": {
    # Reserved for expansibility.
    # If yourr game does not require extra actions from the hub,
    # you can just set to "config": {}
    ...
  }
}
```
The game process should be blocked waiting for the sever response. For all api calls, the hub will respond with http status code 200 on success only. If any other status code is returned, the client should terminate immediately.

Response from the hub:
```json
{
  player_uuid: {
    "name": "xxx",

    # "difficulty" always be one of "player" | "normal" | "easy" | "hard"
    # If set to "player", game send the controller link to the hub later
    # Otherwise, the player is controlled by a bot configured by the game.
    "difficulty": "player"
  },
  player_uuid2: {...}
  ...
  "config": {
    # Reserved for expansibility.
    # If your game does not have extra configurations from the hub,
    # It will be set to "config": {}.
    ...
  }
}
```
The game then prepares for the match environment, and notifies the hub that the match is about to start.

POST /api/start/{game-name}
```json
{
  room_uuid: "...",
  player_uuid: {
      # If your game does not use, set it to "controller_link": ""
      "controller_link": "http://xxxxx"
  },
  ...
  # Reserved as before
  # Even if you do not need it,
  # it still has to be set to "config": {}
  "config": {...}
}
```
The game ignores the hub response and starts the match immediately.

### Running
No action required for the game process.
### End
After the game ended, the process running the game sends the results to the hub and quits.

POST api/result/{game-name}
```json
{
  room_uuid: "...",
  player_uuid: {
    field1: xxx,
    field2: xxx,
    ...
  },
  ...
}
```
The server response is ignored. The specific game result definition is defined by the game developer and should be sent to the general chat. If you need to use the "config" field, please also send your specification.

# Valid game-name
battlesnake

tetris

bomberman

conncet4

dots_and_boxes