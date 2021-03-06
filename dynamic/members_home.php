<div class="home-content">
	<div class="main-content">
	<?php
	$phpbb_content_visibility = $phpbb_container->get('content.visibility');

	$ex_fid_ary = array_unique(array_merge(array_keys($auth->acl_getf('!f_read', true)), array_keys($auth->acl_getf('!f_search', true))));

	$not_in_fid = (count($ex_fid_ary)) ? 'WHERE ' . $db->sql_in_set('f.forum_id', $ex_fid_ary, true) . " OR (f.forum_password <> '' AND fa.user_id <> " . (int) $user->data['user_id'] . ')' : "";

	$sql = "SELECT f.forum_id, f.forum_name, f.parent_id, f.forum_type, f.right_id, f.forum_password, f.forum_flags, fa.user_id
		FROM phpbb_forums f
		LEFT JOIN  phpbb_forums_access fa ON (fa.forum_id = f.forum_id
			AND fa.session_id = '" . $db->sql_escape($user->session_id) . "')
		$not_in_fid
		ORDER BY f.left_id";
	$result = $db->sql_query($sql);

	$right_id = 0;
	$reset_search_forum = true;
	while ($row = $db->sql_fetchrow($result))
	{
		if ($row['forum_password'] && $row['user_id'] != $user->data['user_id'])
		{
			$ex_fid_ary[] = (int) $row['forum_id'];
			continue;
		}
	}
	$db->sql_freeresult($result);

	$m_approve_posts_fid_sql = $phpbb_content_visibility->get_global_visibility_sql('post', $ex_fid_ary, 'p.');
	$m_approve_topics_fid_sql = $phpbb_content_visibility->get_global_visibility_sql('topic', $ex_fid_ary, 't.');

	// get unread posts
	$sql_where = 'AND t.topic_moved_id = 0
					AND ' . $m_approve_topics_fid_sql . '
					' . ((count($ex_fid_ary)) ? 'AND ' . $db->sql_in_set('t.forum_id', $ex_fid_ary, true) : '');

	$unread_ids = get_unread_topics($user->data['user_id'], $sql_where);
	$unread_posts = [];

	if (count($unread_ids) > 0) { // if we have unread post ids, gather their post data
		$sql = 'SELECT t.topic_id, t.forum_id, t.topic_title, t.topic_last_post_time, t.topic_last_poster_name,
			t.topic_last_poster_colour, t.topic_last_post_id
				FROM phpbb_topics t
				WHERE ' . $db->sql_in_set('t.topic_id', array_keys($unread_ids)) . ' ORDER BY t.topic_last_post_time DESC';
		$result = $db->sql_query($sql);
		while ($row = $db->sql_fetchrow($result))
		{
			// format our data
			$datetime = new DateTime("now", new DateTimeZone($user->data['user_timezone']));
			$datetime->setTimestamp($row['topic_last_post_time']);
			$unread_posts[] = [
				'topic_id' 				=> 	$row['topic_id'],
				'forum_id' 				=> 	$row['forum_id'],
				'topic_title' 			=> 	$row['topic_title'],
				'last_post_time' 		=> 	$row['topic_last_post_time'],
				'last_poster'	 		=> 	$row['topic_last_poster_name'],
				'last_poster_colour' 	=> 	$row['topic_last_poster_colour'],
				'last_post_id'			=> 	$row['topic_last_post_id'],
				'datetime_formatted'	=> 	$datetime->format($user->data['user_dateformat'])
			];
		}
	}

	if (count($unread_posts) > 0) {
		$count = 0;
		$display = 10;
		echo '<h2>Unread Posts</h2>';
		echo '<ul>';
		foreach ($unread_posts as $p) {
			echo '<li><a href="/forums/viewtopic.php?f=' . $p['forum_id'] . '&t=' . $p['topic_id'] . '#p' . $p['last_post_id'].'">';
			echo $p['topic_title'];
			echo ' by ' . $p['last_poster'] . ' at ' . $p['datetime_formatted'];
			echo '</a></li>';

			$count++;
			if ($count >= $display)
				break;
		}
		if ($count >= $display)
			echo '<li><a href="/forums/search.php?search_id=unreadposts">' . (count($unread_posts) - $display) . ' more unread posts, continue reading on the forums</a></li>';
		echo '</ul>';
	}
	?>
	<h2>Clan News</h2>
	<?php
	$wiki_contents = file_get_contents('https://clanquest.org/wiki/api.php?action=parse&page=Wiki_News&prop=text&disableeditsection=true&format=json');
	$json = json_decode($wiki_contents);
	echo $json->parse->text->{'*'};
	?>
	</div>
	<aside class="side-widgets cq-info-box">
		<h2>Upcoming Events</h2>
		<iframe
			src="https://calendar.google.com/calendar/embed?title=Clan%20Quest%20Events&amp;showTitle=0&amp;showNav=0&amp;showTabs=0&amp;showPrint=0&amp;showCalendars=0&amp;mode=AGENDA&amp;height=600&amp;wkst=1&amp;bgcolor=%23ffffff&amp;src=clanquest.org_47b3e6k7791rj8al8mr18iujm0%40group.calendar.google.com&amp;color=%235F6B02&amp;src=clanquest.org_egecc810jrhbl9p7au75rvd49c%40group.calendar.google.com&amp;color=%2342104A&amp;src=clanquest.org_ecai4tp12r30p792i7tghbghos%40group.calendar.google.com&amp;color=%2328754E&amp;src=clanquest.org_iikv32sksnohap5iscjut6fi98%40group.calendar.google.com&amp;color=%23B1440E&amp;src=clanquest.org_cnjh5q7ci6fqic3tnap4r7asr4%40group.calendar.google.com&amp;color=%23711616&amp;src=clanquest.org_s9393s458a7ffaps1deoft1pck%40group.calendar.google.com&amp;color=%23B1440E&amp;src=clanquest.org_bu3rhro5uufh6amfg5fd23nof8%40group.calendar.google.com&amp;color=%23711616&amp;ctz=UTC"
			frameborder="0"
			scrolling="no"
			class="google-calendar-embed"></iframe>
		<?php if(!$user->data['user_new']): ?>
			<h2>Discord</h2>
			<iframe src="https://discordapp.com/widget?id=132427319246585856&theme=dark" allowtransparency="true" frameborder="0" class="discord-widget"></iframe>
		<?php endif; ?>
	</aside>
</div>
