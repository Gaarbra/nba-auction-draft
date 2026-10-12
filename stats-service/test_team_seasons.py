import os
os.environ['STATS_CACHE_ONLY'] = '1'
os.environ['DATABASE_URL'] = ''
import unittest
from unittest.mock import patch, Mock
import pandas as pd
import app

class TeamSeasonTests(unittest.TestCase):
    def test_trades_and_separated_stints(self):
        rows = pd.DataFrame([
            {'TEAM_ABBREVIATION':'CLE','GP':50,'SEASON_ID':'2009-10'},
            {'TEAM_ABBREVIATION':'MIA','GP':70,'SEASON_ID':'2010-11'},
            {'TEAM_ABBREVIATION':'CLE','GP':30,'SEASON_ID':'2014-15'},
            {'TEAM_ABBREVIATION':'TOT','GP':80,'SEASON_ID':'2014-15'},
            {'TEAM_ABBREVIATION':'PHI','GP':0,'SEASON_ID':'2026-27'},
        ])
        history = app.team_history(rows)
        self.assertEqual(history[0], {'abbreviation':'CLE','gamesPlayed':80,'seasons':['2009-10','2014-15']})
        self.assertEqual(len(history),2)

    def test_market_includes_saved_roster_and_history_without_network(self):
        career = {'team':'LAL','mostPlayedTeam':'CLE','teamHistory':[{'abbreviation':'MIA','seasons':['2010-11']}], 'firstSeason':'2003-04','lastSeason':'2025-26'}
        with patch.object(app,'_cache',{2544:{'stats':career}}), patch.object(app,'_pool_cache',{'players':[{'id':2544,'currentTeam':'PHI','rosterSeason':'2026-27'}]}):
            # Call the endpoint directly so request-time snapshot reload cannot replace the fixture.
            with app.app.test_request_context('/market-index'):
                players = app.get_market_index().json['players']
            self.assertEqual(players[0]['currentTeam'],'PHI')
            self.assertEqual(players[0]['teamHistory'],career['teamHistory'])

    def test_catalogue_refresh_captures_offseason_roster(self):
        rows = pd.DataFrame([{'PERSON_ID':2544, 'DISPLAY_FIRST_LAST':'LeBron James', 'ROSTERSTATUS':1, 'FROM_YEAR':'2003', 'TO_YEAR':'2026', 'TEAM_ABBREVIATION':'PHI'}])
        response = Mock()
        response.get_data_frames.return_value = [rows]
        with patch.object(app,'CACHE_ONLY',False), patch.object(app,'_pool_cache',{'players':None,'fetchedAt':0}), patch.object(app.commonallplayers,'CommonAllPlayers',return_value=response):
            player = app.fetch_players_pool()[0]
        self.assertEqual(player['currentTeam'],'PHI')
        self.assertRegex(player['rosterSeason'],r'^\d{4}-\d{2}$')

if __name__=='__main__': unittest.main()
