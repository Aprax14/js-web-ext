document.getElementById("runScript").addEventListener("click", async () => {
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (tab && tab.url.includes("chess.com")) {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: chessRiskCalculator,
    });
  } else {
    alert("Start a game on chess.com to use the extension");
  }
});

function chessRiskCalculator() {
  (async () => {
    const opponentDivId = "board-layout-player-top";
    const myDivId = "board-layout-player-bottom";
    
    // ================= FUNCTIONS ===================== //
    
    const getUserName = (divId) => {
      const userDiv = document.getElementById(divId);
      return userDiv
        ? userDiv
            .querySelector("a.user-username-link")
            .innerHTML.trim()
            .toLowerCase()
        : null;
    };
    
    const getCurrentCategoryRating = (divId) => {
      const userDiv = document.getElementById(divId);
      return parseInt(
        userDiv.querySelector("span.user-tagline-rating")
          .innerHTML
          .replace("(", "")
          .replace(")", "")
      )
    }
    
    const archiveList = async (username) => {
      const archivesResponse = await fetch(
        `https://api.chess.com/pub/player/${username}/games/archives`,
      );
      const archivesData = await archivesResponse.json();
    
      if (!archivesData.archives || archivesData.archives.length === 0) {
        console.error("No games found");
        return [];
      }
    
      return archivesData.archives;
    };
    
    const weightGame = (date) => {
      const now = Date.now();
      const daysOffset = (now - date) / (1000 * 60 * 60 * 24); // days
      return Math.exp(-0.4 * daysOffset);
    };
    
    const lastNGames = async (username, gamesNumber) => {
      const archives = await archiveList(username);
      if (archives.length === 0) {
        console.error(`No archives available for ${username}`);
        return [];
      }
    
      let lastGames = [];
    
      while (lastGames.length < gamesNumber && archives.length > 0) {
        let latestArchiveUrl = archives.pop();
        const gamesResponse = await fetch(latestArchiveUrl);
        const gamesData = await gamesResponse.json();
    
        gamesData.games.slice(-(gamesNumber - lastGames.length)).forEach((game) => {
          let result = 0;
          if (game.white.result === "win") {
            result = game.white.username.toLowerCase() === username ? 1 : -1;
          } else if (game.black.result === "win") {
            result = game.black.username.toLowerCase() === username ? 1 : -1;
          }
    
          const date = new Date(game.end_time * 1000);
          lastGames.push({
            data: date,
            result: result,
            weight: weightGame(date),
          });
        });
      }
    
      return lastGames;
    };
    
    const elo = async (username) => {
      const response = await fetch(
        `https://api.chess.com/pub/player/${username}/stats`,
      );
      const data = await response.json();
    
      if (!data || Object.keys(data).length === 0) {
        console.error(`No data found for player ${username}`);
        return null;
      }
    
      const ratings = [];
      if (data.chess_bullet) ratings.push(data.chess_bullet.last.rating);
      if (data.chess_blitz) ratings.push(data.chess_blitz.last.rating);
      if (data.chess_rapid) ratings.push(data.chess_rapid.last.rating);
    
      return Math.max(...ratings);
    };
    
    const calculateDefenseLevel = (games) => {
      const total = games.reduce((total, game) => total + game.result * game.weight, 0);
      return total / games.length;
    };
    
    const calculateThreatLevel = (games) => {
      const total = games.reduce((total, game) => total + game.result * game.weight, 0);
      return total / games.length;
    };
    
    const calculateRiskIndex = (
      myElo,
      myDefenseLevel,
      opponentElo,
      opponentThreatLevel,
      kFactor = 15,
    ) => {
      const winProbability = 1 / (1 + Math.pow(10, (opponentElo - myElo) / 400));
      const lossProbability = 1 - winProbability;
      
      const opponentCategoryElo = getCurrentCategoryRating(opponentDivId);
      const myCategoryElo = getCurrentCategoryRating(myDivId);
      const categoryWinProbability = 1 / (1 + Math.pow(10, (opponentCategoryElo - myCategoryElo) / 400));
      const categoryLossProbability = 1 - categoryWinProbability;
    
      const potentialPointLoss = kFactor * categoryWinProbability;
      const potentialPointGain = kFactor * categoryLossProbability;
    
      const normalizedThreat = (opponentThreatLevel + 1) / 2;  // from -1..1 to 0..1
      const normalizedDefense = (myDefenseLevel + 1) / 2;
      
      const riskFactor = normalizedThreat * (1 - normalizedDefense);
      const adjustedRisk = lossProbability * (1 + riskFactor) * (potentialPointLoss / kFactor);
    
      const risk = Math.min(1, Math.max(0, adjustedRisk));
    
      return {
        winProbability: winProbability,
        potentialPointLoss: potentialPointLoss,
        potentialPointGain: potentialPointGain,
        risk: adjustedRisk,
        threatIndex: opponentThreatLevel,
        defenseIndex: myDefenseLevel,
      };
    };
    
    const gameIndexes = async (myElo, myGames, opponentElo, opponentGames) => {
      const opponentThreatLevel = calculateThreatLevel(opponentGames);
      const myDefenseLevel = calculateDefenseLevel(myGames);
      return calculateRiskIndex(myElo, myDefenseLevel, opponentElo, opponentThreatLevel);
    };
    
    const showRiskBox = (riskIndex) => {
      let box = document.getElementById("riskBox");
    
      if (!box) {
        box = document.createElement("div");
        box.id = "riskBox";
        document.body.appendChild(box);
    
        box.style.position = "fixed";
        box.style.bottom = "20px";
        box.style.right = "20px";
        box.style.padding = "10px";
        box.style.background = "rgba(0, 0, 0, 0.8)";
        box.style.color = "#fff";
        box.style.borderRadius = "8px";
        box.style.fontSize = "14px";
        box.style.zIndex = "9999";
        box.style.boxShadow = "0px 0px 10px rgba(255, 255, 255, 0.2)";
        box.style.maxWidth = "250px";
      }
    
      box.innerHTML = `
          <strong>Game Risk Prevision:</strong><br>
          Win Probability: ${(riskIndex.winProbability * 100).toFixed(2)}%<br>
          Point Gain:      ${(riskIndex.potentialPointGain).toFixed(2)}<br>
          Point Loss:      ${(riskIndex.potentialPointLoss).toFixed(2)}<br>
          Estimated Risk:  ${(riskIndex.risk * 100).toFixed(2)}%<br>
          <br>
          <br>
          <strong>Strength (-100 to 100):</strong><br>
          Defense Index: <b>${(riskIndex.defenseIndex * 100).toFixed(2)}</b><br>
          Threat Index: <b>${(riskIndex.threatIndex * 100).toFixed(2)}</b><br> 
          (Higher = Dangerous, Lower = Weaker)<br>
          <br>
        `;
    };
    
    // ================= CALCULATION ===================== //

    const myUser = getUserName(myDivId);
    const opponentUser = getUserName(opponentDivId);

    if (!myUser || !opponentUser) {
      console.error("Failed to get players usernames");
      return;
    }

    const myElo = await elo(myUser);
    const myGames = await lastNGames(myUser, 10);
    console.log(myGames);
    
    const opponentElo = await elo(opponentUser);
    const opponentGames = await lastNGames(opponentUser, 10);
    console.log(opponentGames);

    console.log(`${myUser} ELO: ${myElo}`);
    console.log(`${opponentUser} ELO: ${opponentElo}`);

    if (!myElo || !opponentElo || opponentGames.length === 0) {
      console.error("Failed to fetch data for evaluation");
      return;
    }

    const riskIndex = await gameIndexes(myElo, myGames, opponentElo, opponentGames);
    showRiskBox(riskIndex);
  })();
}
