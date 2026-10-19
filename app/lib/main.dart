import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:http/http.dart' as http;
import 'package:intl/intl.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_timezone/flutter_timezone.dart';
import 'package:timezone/data/latest_all.dart' as tzdata;
import 'package:timezone/timezone.dart' as tz;
import 'package:shared_preferences/shared_preferences.dart';

const apiBase = String.fromEnvironment('GETLEARNY_API_URL', defaultValue: 'https://getlearny.vercel.app/api/v1');
const ink = Color(0xFF11152B);
const blue = Color(0xFF7057F5);
const mint = Color(0xFFC7BCFF);
const gold = Color(0xFF9BE7FF);
const paper = Color(0xFFF7F8FC);
final ValueNotifier<bool> darkModeNotifier = ValueNotifier<bool>(false);
final GetLearnyNotifications getLearnyNotifications = GetLearnyNotifications();

void main() => runApp(const GetLearnyApp());

class GetLearnyApp extends StatefulWidget {
  const GetLearnyApp({super.key});
  @override State<GetLearnyApp> createState() => _GetLearnyAppState();
}
class _GetLearnyAppState extends State<GetLearnyApp> {
  @override void initState(){super.initState();_loadTheme();getLearnyNotifications.initialize();}
  Future<void> _loadTheme() async {final p=await SharedPreferences.getInstance();darkModeNotifier.value=p.getBool('dark_mode')??false;}
  @override Widget build(BuildContext context) => ValueListenableBuilder<bool>(
    valueListenable: darkModeNotifier,
    builder:(context,dark,_)=>MaterialApp(
      title:'GetLearny',debugShowCheckedModeBanner:false,
      theme:ThemeData(useMaterial3:true,scaffoldBackgroundColor:paper,colorScheme:ColorScheme.fromSeed(seedColor:blue,primary:blue,secondary:gold,brightness:Brightness.light),appBarTheme:const AppBarTheme(backgroundColor:paper,foregroundColor:ink,elevation:0),inputDecorationTheme:InputDecorationTheme(filled:true,fillColor:Colors.white,border:OutlineInputBorder(borderRadius:BorderRadius.all(Radius.circular(14)),borderSide:BorderSide.none),contentPadding:const EdgeInsets.symmetric(horizontal:16,vertical:14)),cardTheme:CardThemeData(color:Colors.white,elevation:0,shape:RoundedRectangleBorder(borderRadius:BorderRadius.circular(20)))),
      darkTheme:ThemeData(useMaterial3:true,brightness:Brightness.dark,colorScheme:ColorScheme.fromSeed(seedColor:mint,primary:mint,secondary:gold,brightness:Brightness.dark),scaffoldBackgroundColor:const Color(0xFF0F1020),appBarTheme:const AppBarTheme(backgroundColor:Color(0xFF0F1020),foregroundColor:Color(0xFFF0F0FA),elevation:0),cardTheme:CardThemeData(color:const Color(0xFF17182C),elevation:0,shape:RoundedRectangleBorder(borderRadius:BorderRadius.circular(20)))),
      themeMode:dark?ThemeMode.dark:ThemeMode.light,home:const Shell()));
}

class GetLearnyNotifications {
 final FlutterLocalNotificationsPlugin plugin=FlutterLocalNotificationsPlugin();
 bool initialized=false;
 Future<void> initialize() async {
  if(initialized)return;
  const settings=InitializationSettings(android:AndroidInitializationSettings('ic_notification'));
  try { await plugin.initialize(settings); } catch (_) { return; }
  tzdata.initializeTimeZones();
  try { final zone=await FlutterTimezone.getLocalTimezone(); tz.setLocalLocation(tz.getLocation(zone)); } catch (_) { tz.setLocalLocation(tz.getLocation('Africa/Accra')); }
  initialized=true;
 }
 Future<bool> requestPermission() async {
  await initialize();
  final android=plugin.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
  return await android?.requestNotificationsPermission() ?? false;
 }
 NotificationDetails get details=>const NotificationDetails(android:AndroidNotificationDetails('getlearny_study','GetLearny study reminders',channelDescription:'Study sessions, progress and learning reminders.',importance:Importance.high,priority:Priority.high,color:Color(0xFF7057F5),icon:'ic_notification'));
 Future<void> showTest() async {await initialize();await plugin.show(7101,'GetLearny notifications are on','Your device notifications are working. Keep making progress.',details);}
 Future<void> scheduleDaily(TimeOfDay time) async {
  await initialize();
  final now=tz.TZDateTime.now(tz.local);
  var next=tz.TZDateTime(tz.local,now.year,now.month,now.day,time.hour,time.minute);
  if(!next.isAfter(now))next=next.add(const Duration(days:1));
  await plugin.zonedSchedule(7102,'Time for a GetLearny study session','Take one small step toward your WASSCE goals.',next,details,androidScheduleMode:AndroidScheduleMode.inexactAllowWhileIdle,matchDateTimeComponents:DateTimeComponents.time);
 }
 Future<void> cancelDaily() async {await plugin.cancel(7102);}
}

class ApiClient {
  static String? token;
  static Future<Map<String, dynamic>> request(String path, {String method='GET', Map<String,dynamic>? body}) async {
    if (apiBase.isEmpty) throw Exception('offline');
    final uri = Uri.parse('$apiBase$path');
    final response = await (method == 'POST'
      ? http.post(uri, headers: _headers(), body: jsonEncode(body ?? {}))
      : method == 'PATCH'
        ? http.patch(uri, headers: _headers(), body: jsonEncode(body ?? {}))
        : http.get(uri, headers: _headers())).timeout(const Duration(seconds: 45));
    final decoded = response.body.isEmpty ? <String,dynamic>{} : jsonDecode(response.body) as Map<String,dynamic>;
    if (response.statusCode < 200 || response.statusCode >= 300) throw Exception(decoded['error'] ?? 'Request failed');
    return decoded;
  }
  static Future<Map<String,dynamic>> upload(String path, PlatformFile file, {Map<String,String> fields=const {}}) async {
    if(token==null)throw Exception('Sign in first');
    final request=http.MultipartRequest('POST',Uri.parse('$apiBase$path'));
    request.headers['Authorization']='Bearer $token';
    request.fields.addAll(fields);
    request.files.add(http.MultipartFile.fromBytes('file',file.bytes!,filename:file.name));
    final streamed=await request.send().timeout(const Duration(seconds:90));
    final response=await http.Response.fromStream(streamed);
    final decoded=response.body.isEmpty?<String,dynamic>{}:jsonDecode(response.body) as Map<String,dynamic>;
    if(response.statusCode<200||response.statusCode>=300)throw Exception(decoded['error']??'Upload failed');
    return decoded;
  }
  static Map<String,String> _headers() => {'Content-Type':'application/json', if (token != null) 'Authorization':'Bearer $token'};
}

class Shell extends StatefulWidget { const Shell({super.key}); @override State<Shell> createState()=>_ShellState(); }
class _ShellState extends State<Shell> {
  int index=0; String name='Learner'; bool signedIn=false;
  final pages = const [DashboardPage(), SubjectsPage(), PracticePage(), JournalPage(), ProfilePage(), DocumentsPage()];
  @override void initState(){ super.initState(); _restore(); }
  Future<void> _restore() async { final p=await SharedPreferences.getInstance(); ApiClient.token=p.getString('token'); if(mounted)setState((){name=p.getString('name')??'Learner'; signedIn=ApiClient.token!=null;}); }
  @override Widget build(BuildContext context)=>Scaffold(
    appBar: AppBar(title: Row(children:[Container(width:38,height:38,decoration:BoxDecoration(gradient:const LinearGradient(colors:[Color(0xFF8B72FF),Color(0xFF5B43D6)]),borderRadius:BorderRadius.circular(13)),child:const Center(child:Icon(Icons.auto_stories_rounded,color:Colors.white,size:23))),const SizedBox(width:10),const Text('GetLearny',style:TextStyle(fontWeight:FontWeight.w800,letterSpacing:-.5)),const Spacer(),IconButton(tooltip:'Device notifications',onPressed:()=>setState(()=>index=4),icon:const Icon(Icons.notifications_active_outlined)),IconButton(tooltip:darkModeNotifier.value?'Switch to light mode':'Switch to dark mode',onPressed:()async{darkModeNotifier.value=!darkModeNotifier.value;final p=await SharedPreferences.getInstance();await p.setBool('dark_mode',darkModeNotifier.value);},icon:Icon(darkModeNotifier.value?Icons.light_mode_outlined:Icons.dark_mode_outlined)),IconButton(onPressed:()=>setState(()=>index=4),icon:const Icon(Icons.account_circle_outlined))])),
    body: SafeArea(child:IndexedStack(index:index,children: pages.map((p)=>p is DashboardPage ? DashboardPage(name:name) : p).toList())),
    bottomNavigationBar: NavigationBar(selectedIndex:index,onDestinationSelected:(i)=>setState(()=>index=i),destinations:const [NavigationDestination(icon:Icon(Icons.grid_view_rounded),label:'Home'),NavigationDestination(icon:Icon(Icons.menu_book_rounded),label:'Subjects'),NavigationDestination(icon:Icon(Icons.quiz_outlined),label:'Practice'),NavigationDestination(icon:Icon(Icons.edit_note_rounded),label:'Journal'),NavigationDestination(icon:Icon(Icons.person_outline),label:'Profile'),NavigationDestination(icon:Icon(Icons.folder_open_outlined),label:'Files')]),
  );
}

class DashboardPage extends StatefulWidget { final String name; const DashboardPage({super.key,this.name='Learner'}); @override State<DashboardPage> createState()=>_DashboardPageState(); }
class _DashboardPageState extends State<DashboardPage> {
  int done=0; bool loading=false; Map<String,dynamic>? remote;
  @override void initState(){super.initState(); _load();}
  Future<void> _load() async { if(apiBase.isEmpty)return; setState(()=>loading=true); try {final r=await ApiClient.request('/dashboard'); if(mounted)setState(()=>remote=r);} catch (_) {} finally {if(mounted)setState(()=>loading=false);} }
  @override Widget build(BuildContext context)=>ListView(padding:const EdgeInsets.fromLTRB(20,8,20,28),children:[
    Text(DateFormat('EEEE, d MMMM').format(DateTime.now()).toUpperCase(),style:TextStyle(fontSize:11,letterSpacing:1.5,fontWeight:FontWeight.w800,color:Colors.blueGrey.shade500)),const SizedBox(height:8),
    Text('Let’s make progress, ${widget.name.split(' ').first}.',style:const TextStyle(fontSize:26,fontWeight:FontWeight.w900,color:ink,height:1.12)),const SizedBox(height:18),
    Container(padding:const EdgeInsets.all(22),decoration:BoxDecoration(gradient:const LinearGradient(colors:[ink,Color(0xFF292452)],begin:Alignment.topLeft,end:Alignment.bottomRight),borderRadius:BorderRadius.circular(24)),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[Row(children:[const Expanded(child:Text('YOUR WASSCE JOURNEY',style:TextStyle(color:gold,fontSize:11,letterSpacing:1.3,fontWeight:FontWeight.w800))),Container(padding:const EdgeInsets.symmetric(horizontal:10,vertical:6),decoration:BoxDecoration(color:Colors.white.withValues(alpha:.12),borderRadius:BorderRadius.circular(20)),child:const Text('STUDY PLAN',style:TextStyle(color:Colors.white,fontSize:11,fontWeight:FontWeight.w700)))]),const SizedBox(height:14),const Text('Small steps.\nStrong results.',style:TextStyle(color:Colors.white,fontSize:28,fontWeight:FontWeight.w900,height:1.1)),const SizedBox(height:10),Text('Build the foundations you need, one topic at a time.',style:TextStyle(color:Colors.white.withValues(alpha:.78))),const SizedBox(height:18),Row(children:[Expanded(child:FilledButton(onPressed:()=>Navigator.of(context).push(MaterialPageRoute(builder:(_)=>const SubjectsPage())),style:FilledButton.styleFrom(backgroundColor:gold,foregroundColor:ink),child:const Text('Continue learning'))),const SizedBox(width:10),IconButton.filledTonal(onPressed:()=>Navigator.of(context).push(MaterialPageRoute(builder:(_)=>const PracticePage())),icon:const Icon(Icons.arrow_forward_rounded))])])),
    const SizedBox(height:22),Row(children:[const Expanded(child:SectionTitle('Your overview')),if(loading)const SizedBox(width:16,height:16,child:CircularProgressIndicator(strokeWidth:2))]),const SizedBox(height:12),Row(children:[Expanded(child:StatCard(icon:Icons.local_fire_department_outlined,label:'Study streak',value:'—',tint:Color(0xFFEFEDFF))),const SizedBox(width:10),Expanded(child:StatCard(icon:Icons.task_alt,label:'Topics covered',value:'${remote?['progress']?['completedTopics'] ?? done}',tint:Color(0xFFEFEDFF))),const SizedBox(width:10),Expanded(child:StatCard(icon:Icons.timer_outlined,label:'This week',value:remote==null?'—':'${remote?['progress']?['minutesStudied'] ?? 0} min',tint:Color(0xFFE5FAFF)))]),
    const SizedBox(height:24),const SectionTitle('Continue learning'),const SizedBox(height:12),Card(child:ListTile(leading:const Icon(Icons.menu_book_rounded,color:blue,size:30),title:const Text('Open your subjects',style:TextStyle(fontWeight:FontWeight.w800)),subtitle:const Text('Browse published topics and resume saved lessons'),trailing:const Icon(Icons.chevron_right),onTap:()=>Navigator.of(context).push(MaterialPageRoute(builder:(_)=>const SubjectsPage())))),
    const SizedBox(height:18),Container(padding:const EdgeInsets.all(18),decoration:BoxDecoration(color:const Color(0xFFE5FAFF),borderRadius:BorderRadius.circular(20)),child:const Row(crossAxisAlignment:CrossAxisAlignment.start,children:[Icon(Icons.lightbulb_outline,color:Color(0xFF3C4B88)),SizedBox(width:12),Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[Text('Today’s reminder',style:TextStyle(fontWeight:FontWeight.w800,color:ink)),SizedBox(height:5),Text('Learn the basics first. If a topic feels difficult, revisit its prerequisites before moving on.',style:TextStyle(height:1.4,color:ink))]))]))
  ]);
}

class OfflineLessonStore {
 static const key='getlearny_offline_lessons_v1';
 static Future<List<Map<String,dynamic>>> all()async{
  final p=await SharedPreferences.getInstance();final raw=p.getString(key);if(raw==null)return [];
  try{final rows=(jsonDecode(raw) as List).map((e)=>Map<String,dynamic>.from(e as Map)).toList();final now=DateTime.now().millisecondsSinceEpoch;final valid=rows.where((e)=>(e['expiresAt'] as num? ?? 0)>now).toList();if(valid.length!=rows.length)await p.setString(key,jsonEncode(valid));return valid;}catch(_){return [];}
 }
 static Future<void> save({required String subject,required String topic,required String content})async{
  final rows=await all();_lastRows=rows;rows.removeWhere((e)=>e['subject']==subject&&e['topic']==topic);final now=DateTime.now();
  rows.insert(0,{'subject':subject,'topic':topic,'content':content,'savedAt':now.toIso8601String(),'expiresAt':now.add(const Duration(days:7)).millisecondsSinceEpoch});
  final p=await SharedPreferences.getInstance();_lastRows=rows.take(100).toList();await p.setString(key,jsonEncode(_lastRows));
 }
 static Map<String,dynamic>? find({required String subject,required String topic}){for(final e in _lastRows){if(e['subject']==subject&&e['topic']==topic)return e;}return null;}
 static List<Map<String,dynamic>> _lastRows=[];
 static List<Map<String,dynamic>> cachedForSubject(String subject)=>_lastRows.where((e)=>e['subject']==subject).toList();
 static Future<void> refresh()async{_lastRows=await all();}
}
class OfflineLessonsPage extends StatefulWidget {final String? subject;const OfflineLessonsPage({super.key,this.subject});@override State<OfflineLessonsPage> createState()=>_OfflineLessonsPageState();}
class _OfflineLessonsPageState extends State<OfflineLessonsPage>{bool loading=true;List<Map<String,dynamic>> lessons=[];@override void initState(){super.initState();_load();}Future<void> _load()async{await OfflineLessonStore.refresh();if(mounted)setState((){lessons=OfflineLessonStore._lastRows.where((e)=>widget.subject==null||e['subject']==widget.subject).toList();loading=false;});}
 @override Widget build(BuildContext context)=>Scaffold(appBar:AppBar(title:const Text('Offline lessons')),body:ListView(padding:const EdgeInsets.all(20),children:[const Text('Downloaded lessons stay on this device for 7 days. Download while connected; opening saved lessons does not need the internet.'),const SizedBox(height:16),if(loading)const Center(child:CircularProgressIndicator()),if(!loading&&lessons.isEmpty)const Text('No downloaded lessons yet. Open a subject while online and choose “Download next 3 lessons”.'),...lessons.map((item)=>Card(child:ListTile(leading:const Icon(Icons.offline_pin_outlined,color:blue),title:Text(item['topic']?.toString()??''),subtitle:Text('${item['subject']} · saved ${item['savedAt']?.toString().substring(0,10)??''}'),onTap:()=>Navigator.of(context).push(MaterialPageRoute(builder:(_)=>OfflineLessonReader(item:item))))))]));
}
class OfflineLessonReader extends StatelessWidget {final Map<String,dynamic> item;const OfflineLessonReader({super.key,required this.item});@override Widget build(BuildContext context)=>Scaffold(appBar:AppBar(title:Text(item['subject']?.toString()??'Offline lesson')),body:ListView(padding:const EdgeInsets.all(20),children:[Text(item['topic']?.toString()??'',style:const TextStyle(fontSize:24,fontWeight:FontWeight.w900)),const SizedBox(height:12),Card(child:Padding(padding:const EdgeInsets.all(18),child:MarkdownBody(data:item['content']?.toString()??'')))]));}

class SubjectsPage extends StatelessWidget {
 const SubjectsPage({super.key});
 static const items=[['Core Mathematics','MATH'],['English Language','ENG'],['Chemistry','CHEM'],['Biology','BIO'],['Social Studies','SOC'],['Additional Mathematics','EMATH'],['Computer Science','CS']];
 @override Widget build(BuildContext context)=>ListView(padding:const EdgeInsets.all(20),children:[
  const SectionTitle('Your subjects'),const SizedBox(height:6),
  const Text('Subjects open a live catalogue from GetLearny. Topics and lessons are not fabricated when the service is unavailable.'),
  const SizedBox(height:16),
  FilledButton.icon(onPressed:()=>Navigator.of(context).push(MaterialPageRoute(builder:(_)=>const OfflineLessonsPage())),icon:const Icon(Icons.offline_pin_outlined),label:const Text('My downloaded lessons')),
  const SizedBox(height:12),
  ...items.map((e)=>Card(child:ListTile(contentPadding:const EdgeInsets.all(14),leading:Container(width:48,height:48,decoration:BoxDecoration(color:const Color(0xFFEFEDFF),borderRadius:BorderRadius.circular(14)),child:const Icon(Icons.menu_book_rounded,color:blue)),title:Text(e[0],style:const TextStyle(fontWeight:FontWeight.w800)),subtitle:const Text('Open live topics and lessons'),trailing:const Icon(Icons.chevron_right),onTap:()=>Navigator.of(context).push(MaterialPageRoute(builder:(_)=>TopicListPage(subject:e[0]))))))
 ]);
}

class TopicListPage extends StatefulWidget {
 final String subject;
 const TopicListPage({super.key,required this.subject});
 @override State<TopicListPage> createState()=>_TopicListPageState();
}
class _TopicListPageState extends State<TopicListPage>{
 bool loading=false,downloading=false,uploadingMaterial=false; String error=''; List<Map<String,dynamic>> topics=[];
 final topicController=TextEditingController();
 @override void dispose(){topicController.dispose();super.dispose();}
 String get code=>({'Mathematics':'MATH','Core Mathematics':'MATH','English':'ENG','English Language':'ENG','Chemistry':'CHEM','Biology':'BIO','Integrated Science':'SCI','Social Studies':'SOC','Add Math':'EMATH','Additional Mathematics':'EMATH','Elective Mathematics':'EMATH','Computer Science':'CS','ICT':'ICT'}[widget.subject]??widget.subject.toUpperCase().replaceAll(RegExp(r'[^A-Z0-9_-]'),''));
 @override void initState(){super.initState();_loadTopics();}
 Future<void> _loadTopics()async{
  await OfflineLessonStore.refresh();
  setState((){loading=true;error='';});
  try{final result=await ApiClient.request('/topics?subject=$code&limit=100');final rows=(result['topics'] as List? ?? []);if(!mounted)return;setState(()=>topics=rows.map((e)=>Map<String,dynamic>.from(e as Map)).toList());}
  catch(e){if(mounted)setState(()=>error='Live topic catalogue unavailable. Downloaded lessons remain available offline.');}
  finally{if(mounted)setState(()=>loading=false);}
 }
 Future<void> _uploadSubjectMaterial() async {
  if(ApiClient.token==null){ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content:Text('Sign in before uploading study materials.')));return;}
  try{
   final picked=await FilePicker.platform.pickFiles(type:FileType.custom,allowedExtensions:const ['pdf','txt','md','markdown','csv','json','png','jpg','jpeg','webp'],withData:true);
   if(picked==null)return;
   final file=picked.files.single;
   if(file.bytes==null)throw Exception('Could not read this file. Please choose it again.');
   if(file.size>12*1024*1024)throw Exception('Choose a file smaller than 12 MB.');
   if(!mounted)return;setState(()=>uploadingMaterial=true);
   final result=await ApiClient.upload('/documents',file,fields:{'subject_name':widget.subject,'material_title':file.name});
   final document=Map<String,dynamic>.from(result['document'] as Map? ?? {});
   final status=document['processing_status']?.toString()??'uploaded';
   final message=result['message']?.toString()??(status=='ready'?'Material saved and text extracted.':'Material uploaded.');
   if(mounted)ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text('$message Open Profile → Study materials to view it.')));
  }catch(e){if(mounted)ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text('Upload failed: ${e.toString().replaceFirst('Exception: ','')}')));}
  finally{if(mounted)setState(()=>uploadingMaterial=false);}
 }

 Future<void> _downloadThree()async{
  if(ApiClient.token==null){ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content:Text('Sign in before downloading lessons.')));return;}
  if(topics.isEmpty){ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content:Text('No live topics are available to download yet. Connect and retry.')));return;}
  setState(()=>downloading=true);int saved=0;
  try{
   for(final row in topics.take(3)){
    final topic=row['title']?.toString()??'';if(topic.isEmpty)continue;
    final result=await ApiClient.request('/lessons/generate',method:'POST',body:{'subject':widget.subject,'topic':topic,'level':'Not specified','exam':'WASSCE'});
    final lesson=result['lesson']?.toString()??'';if(lesson.trim().isEmpty)continue;
    await OfflineLessonStore.save(subject:widget.subject,topic:topic,content:lesson);saved++;
   }
   if(mounted)ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text(saved==0?'No lessons were returned by the service.':'Saved $saved real lesson(s) for offline reading for 7 days.')));
  }catch(e){if(mounted)ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text('Download stopped: ${e.toString().replaceFirst('Exception: ','')}')));}
  finally{if(mounted)setState(()=>downloading=false);}
 }
 @override Widget build(BuildContext context)=>Scaffold(appBar:AppBar(title:Text(widget.subject)),body:ListView(padding:const EdgeInsets.all(20),children:[
  Text('Study path',style:Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight:FontWeight.w900)),const SizedBox(height:8),
  const Text('Topics are loaded from the live GetLearny catalogue.'),
  const SizedBox(height:14),
  FilledButton.icon(onPressed:loading||downloading?null:_downloadThree,icon:downloading?const SizedBox(width:18,height:18,child:CircularProgressIndicator(strokeWidth:2)):const Icon(Icons.download_for_offline_outlined),label:Text(downloading?'Downloading lessons…':'Download next 3 lessons · keep offline 7 days')),
  const SizedBox(height:12),
  OutlinedButton.icon(onPressed:()=>Navigator.of(context).push(MaterialPageRoute(builder:(_)=>OfflineLessonsPage(subject:widget.subject))),icon:const Icon(Icons.library_books_outlined),label:const Text('Open saved lessons')),
  const SizedBox(height:8),
  OutlinedButton.icon(onPressed:uploadingMaterial?null:_uploadSubjectMaterial,icon:uploadingMaterial?const SizedBox(width:18,height:18,child:CircularProgressIndicator(strokeWidth:2)):const Icon(Icons.upload_file_outlined),label:Text(uploadingMaterial?'Uploading and processing…':'Upload subject material · OCR')),
  const SizedBox(height:16),
  TextField(controller:topicController,textInputAction:TextInputAction.go,onSubmitted:(value){final topic=value.trim();if(topic.isNotEmpty)Navigator.of(context).push(MaterialPageRoute(builder:(_)=>LessonPage(subject:widget.subject,topic:topic)));},decoration:const InputDecoration(labelText:'Study any topic',hintText:'Type a topic to learn, even if it is not in the catalogue',prefixIcon:Icon(Icons.search))),
  const SizedBox(height:8),
  FilledButton.icon(onPressed:(){final topic=topicController.text.trim();if(topic.isEmpty){ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content:Text('Enter a topic first.')));return;}Navigator.of(context).push(MaterialPageRoute(builder:(_)=>LessonPage(subject:widget.subject,topic:topic)));},icon:const Icon(Icons.auto_stories_outlined),label:const Text('Generate lesson for this topic')),
  const SizedBox(height:16),
  if(loading)const Center(child:Padding(padding:EdgeInsets.all(28),child:CircularProgressIndicator())),
  if(error.isNotEmpty)...[Text(error,style:const TextStyle(color:Colors.deepOrange)),TextButton.icon(onPressed:_loadTopics,icon:const Icon(Icons.refresh),label:const Text('Retry'))],
  if(!loading&&error.isEmpty&&topics.isEmpty)const Text('No topics are published for this subject yet.'),
  ...topics.map((topic)=>Card(child:ListTile(leading:CircleAvatar(backgroundColor:gold,foregroundColor:ink,child:const Icon(Icons.menu_book_outlined)),title:Text(topic['title']?.toString()??'Topic',style:const TextStyle(fontWeight:FontWeight.w700)),subtitle:Text(topic['description']?.toString()??''),trailing:const Icon(Icons.arrow_forward_ios,size:15),onTap:()=>Navigator.of(context).push(MaterialPageRoute(builder:(_)=>LessonPage(subject:widget.subject,topic:topic['title']?.toString()??'')))))) ,
  if(error.isNotEmpty) ...OfflineLessonStore.cachedForSubject(widget.subject).map((item)=>Card(child:ListTile(leading:const Icon(Icons.offline_pin_outlined),title:Text(item['topic']??''),subtitle:const Text('Saved lesson · available offline'),onTap:()=>Navigator.of(context).push(MaterialPageRoute(builder:(_)=>OfflineLessonReader(item:item))))))
 ]));
}

class LessonPage extends StatefulWidget {final String subject,topic;const LessonPage({super.key,required this.subject,required this.topic});@override State<LessonPage> createState()=>_LessonPageState();}
class _LessonPageState extends State<LessonPage>{bool busy=false;String? lesson;String error='';@override void initState(){super.initState();_generate();}Future<void> _generate()async{
 await OfflineLessonStore.refresh();
 final cached=OfflineLessonStore.find(subject:widget.subject,topic:widget.topic);
 if(!mounted)return;
 if(!await _hasNetworkHint()){if(cached!=null){setState(()=>lesson=cached['content'] as String?);return;}setState(()=>error='You are offline and this lesson has not been downloaded on this device yet.');return;}
 if(ApiClient.token==null){if(cached!=null){setState(()=>lesson=cached['content'] as String?);return;}setState(()=>error='Sign in to generate and save lessons.');return;}
 setState(()=>busy=true);try{final r=await ApiClient.request('/lessons/generate',method:'POST',body:{'subject':widget.subject,'topic':widget.topic,'level':'Not specified','exam':'WASSCE'});final text=r['lesson'] as String?;if(text==null||text.trim().isEmpty)throw Exception('The lesson service returned no lesson.');await OfflineLessonStore.save(subject:widget.subject,topic:widget.topic,content:text);if(mounted)setState(()=>lesson=text);}catch(e){if(mounted){if(cached!=null)setState(()=>lesson=cached['content'] as String?);else setState(()=>error=e.toString().replaceFirst('Exception: ',''));}}finally{if(mounted)setState(()=>busy=false);}}
 Future<bool> _hasNetworkHint()async{try{final uri=Uri.parse(apiBase);return uri.hasScheme&&uri.host.isNotEmpty;}catch(_){return false;}}
 @override Widget build(BuildContext context)=>Scaffold(appBar:AppBar(title:Text(widget.subject)),body:ListView(padding:const EdgeInsets.all(20),children:[Text(widget.topic,style:const TextStyle(fontSize:26,fontWeight:FontWeight.w900)),const SizedBox(height:8),const Text('LEARN • UNDERSTAND • APPLY',style:TextStyle(color:blue,fontSize:11,letterSpacing:1.3,fontWeight:FontWeight.w800)),if(error.isNotEmpty)...[Padding(padding:const EdgeInsets.only(top:12),child:Text(error,style:const TextStyle(color:Colors.deepOrange))),TextButton.icon(onPressed:_generate,icon:const Icon(Icons.refresh),label:const Text('Retry'))],const SizedBox(height:16),if(busy)const Center(child:CircularProgressIndicator())else if(lesson!=null)Card(child:Padding(padding:const EdgeInsets.all(18),child:MarkdownBody(data:lesson!))),const SizedBox(height:18),FilledButton.icon(onPressed:()=>Navigator.of(context).push(MaterialPageRoute(builder:(_)=>const PracticePage())),icon:const Icon(Icons.quiz_outlined),label:const Text('Try AI practice questions'))]));
}

class PracticePage extends StatefulWidget {const PracticePage({super.key});@override State<PracticePage> createState()=>_PracticePageState();}
class _PracticePageState extends State<PracticePage>{
 final topicController=TextEditingController();String subject='Core Mathematics';int count=10;bool loading=false,grading=false,finished=false,gradingFailed=false;int secondsLeft=0,score=0,currentIndex=0;Timer? timer;String feedback='',gradeError='';List<Map<String,dynamic>> questions=[];List<int?> answers=[];
 static const subjects=['Core Mathematics','English Language','Chemistry','Biology','Social Studies','Additional Mathematics','Computer Science'];
 @override void dispose(){timer?.cancel();topicController.dispose();super.dispose();}
 Future<void> generate()async{
  if(ApiClient.token==null){ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content:Text('Sign in from Profile to generate AI practice.')));return;}
  setState(()=>loading=true);try{final r=await ApiClient.request('/practice/generate',method:'POST',body:{'subject':subject,'topic':topicController.text.trim(),'level':'Not specified','count':count});final rows=(r['questions'] as List? ?? []);if(rows.length<count)throw Exception('The AI service returned fewer questions than requested. Please retry.');questions=rows.map((e)=>Map<String,dynamic>.from(e as Map)).toList();answers=List<int?>.filled(questions.length,null);score=0;currentIndex=0;feedback='';finished=false;secondsLeft=questions.length*60;startTimer();}catch(e){if(mounted)ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text(e.toString().replaceFirst('Exception: ',''))));}finally{if(mounted)setState(()=>loading=false);}
 }
 void startTimer(){timer?.cancel();timer=Timer.periodic(const Duration(seconds:1),(t){if(!mounted)return;if(secondsLeft<=1){setState(()=>secondsLeft=0);t.cancel();grade(expired:true);}else setState(()=>secondsLeft--);});}
 Future<void> grade({bool expired=false})async{
  if(finished||questions.isEmpty)return;timer?.cancel();setState(()=>{grading=true;gradingFailed=false;gradeError='';});
  try{final r=await ApiClient.request('/practice/grade',method:'POST',body:{'subject':subject,'questions':questions.map((q)=>{'question':q['question'],'options':q['options'],'answer':q['answer'],'explanation':q['explanation']??''}).toList(),'answers':answers});score=(r['score'] as num? ?? 0).toInt();feedback=r['feedback']?.toString()??'';try{await ApiClient.request('/tests',method:'POST',body:{'subject':subject,'title':'Timed AI practice','score':score,'max_score':questions.length});}catch(_){}}
  catch(e){if(mounted)setState(()=>{gradingFailed=true;gradeError=e.toString().replaceFirst('Exception: ','');});}
  finally{if(mounted)setState(()=>grading=false);}
  if(mounted&&!gradingFailed)setState(()=>finished=true);
 }
 @override Widget build(BuildContext context){
  if(questions.isEmpty)return Scaffold(appBar:AppBar(title:const Text('AI practice')),body:ListView(padding:const EdgeInsets.all(20),children:[const SectionTitle('Build a timed practice set'),const SizedBox(height:8),const Text('Questions are generated by the live AI service. No sample questions are substituted.'),const SizedBox(height:18),DropdownButtonFormField<String>(value:subject,decoration:const InputDecoration(labelText:'Subject'),items:subjects.map((s)=>DropdownMenuItem(value:s,child:Text(s))).toList(),onChanged:(v){if(v!=null)setState(()=>subject=v);}),const SizedBox(height:12),TextField(controller:topicController,decoration:const InputDecoration(labelText:'Topic (optional)',hintText:'Enter a topic from your class notes')),const SizedBox(height:12),DropdownButtonFormField<int>(value:count,decoration:const InputDecoration(labelText:'Questions · one minute each'),items:const [5,10,15].map((n)=>DropdownMenuItem(value:n,child:Text('$n questions · $n minutes'))).toList(),onChanged:(v){if(v!=null)setState(()=>count=v);}),const SizedBox(height:18),FilledButton.icon(onPressed:loading?null:generate,icon:loading?const SizedBox(width:18,height:18,child:CircularProgressIndicator(strokeWidth:2)):const Icon(Icons.auto_awesome),label:Text(loading?'Generating from AI…':'Generate timed exam'))]));
  if(finished)return Scaffold(appBar:AppBar(title:const Text('Practice result')),body:ListView(padding:const EdgeInsets.all(20),children:[const SectionTitle('Answers locked and graded'),Text('$score / ${questions.length}',style:const TextStyle(fontSize:32,fontWeight:FontWeight.w900)),if(feedback.isNotEmpty)Card(child:Padding(padding:const EdgeInsets.all(16),child:MarkdownBody(data:feedback))),FilledButton(onPressed:(){setState((){questions=[];answers=[];finished=false;feedback='';currentIndex=0;});},child:const Text('Create another practice set'))]));
  final index=currentIndex.clamp(0,questions.length-1);
  final q=questions[index];
  final options=(q['options'] as List? ?? []).map((e)=>e.toString()).toList();
  return Scaffold(appBar:AppBar(title:Text(subject),actions:[Padding(padding:const EdgeInsets.all(16),child:Center(child:Text('${secondsLeft~/60}:${(secondsLeft%60).toString().padLeft(2,'0')}',style:TextStyle(fontWeight:FontWeight.w900,color:secondsLeft<=60?Colors.red:blue))))]),body:ListView(padding:const EdgeInsets.all(20),children:[Text('QUESTION ${index+1} OF ${questions.length}',style:const TextStyle(color:blue,fontWeight:FontWeight.w800,letterSpacing:1.2)),const SizedBox(height:12),Text(q['question']?.toString()??'',style:const TextStyle(fontSize:22,fontWeight:FontWeight.w900)),const SizedBox(height:18),...options.asMap().entries.map((e)=>Card(child:RadioListTile<int>(value:e.key,groupValue:answers[index],onChanged:grading||gradingFailed?null:(v)=>setState(()=>answers[index]=v),title:Text(e.value)))),if(gradingFailed)...[Text('Your answers are locked, but the server could not finish grading: $gradeError',style:const TextStyle(color:Colors.deepOrange)),const SizedBox(height:8),FilledButton.icon(onPressed:grading?null:grade,icon:const Icon(Icons.refresh),label:const Text('Retry grading'))],const SizedBox(height:18),if(!gradingFailed)FilledButton(onPressed:grading?null:()=>index==questions.length-1?grade():setState(()=>currentIndex=index+1),child:Text(grading?'Grading…':index==questions.length-1?'Submit and grade':'Next question'))]));
 }
}

class JournalPage extends StatefulWidget{const JournalPage({super.key});@override State<JournalPage> createState()=>_JournalPageState();}
class _JournalPageState extends State<JournalPage>{final learned=TextEditingController();final difficult=TextEditingController();final next=TextEditingController();final entries=<Map<String,String>>[];@override void dispose(){learned.dispose();difficult.dispose();next.dispose();super.dispose();}@override void initState(){super.initState();_loadEntries();}
Future<void> _loadEntries()async{
 if(ApiClient.token==null)return;
 try{
  final result=await ApiClient.request('/journal');
  final rows=(result['entries'] as List? ?? []);
  if(!mounted)return;
  setState(()=>entries
   ..clear()
   ..addAll(rows.map((row){final e=Map<String,dynamic>.from(row as Map);return <String,String>{
    'date':e['created_at']==null?'Recent':DateFormat('d MMM yyyy').format(DateTime.parse(e['created_at'].toString()).toLocal()),
    'learned':e['learned']?.toString()??'','difficult':e['difficult']?.toString()??'','next':e['next_step']?.toString()??''
   };})));
 }catch(_){}
}
Future<void> save()async{
 if(learned.text.trim().isEmpty)return;
 if(ApiClient.token==null){ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content:Text('Sign in from Profile before syncing your journal.')));return;}
 final entry={'date':DateFormat('d MMM yyyy').format(DateTime.now()),'learned':learned.text.trim(),'difficult':difficult.text.trim(),'next':next.text.trim()};
 try{
  await ApiClient.request('/journal',method:'POST',body:{'learned':entry['learned'],'difficult':entry['difficult'],'next_step':entry['next']});
 }catch(e){ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text('Could not sync reflection: ${e.toString().replaceFirst('Exception: ','')}')));return;}
 setState(()=>entries.insert(0,entry));
 learned.clear();difficult.clear();next.clear();FocusScope.of(context).unfocus();
 ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content:Text('Study reflection synced to your account.')));
}
@override Widget build(BuildContext context)=>ListView(padding:const EdgeInsets.all(20),children:[const SectionTitle('Learning journal'),const SizedBox(height:6),const Text('A quick reflection helps you spot what to revise next.'),const SizedBox(height:18),JournalField(label:'What did you learn today?',hint:'I finally understand…',controller:learned),const SizedBox(height:12),JournalField(label:'What was difficult?',hint:'I need more practice with…',controller:difficult),const SizedBox(height:12),JournalField(label:'What will you do next?',hint:'Tomorrow I will…',controller:next),const SizedBox(height:14),FilledButton.icon(onPressed:save,icon:const Icon(Icons.save_outlined),label:const Text('Save reflection')),const SizedBox(height:24),const SectionTitle('Recent reflections'),const SizedBox(height:10),if(entries.isEmpty)const Text('Your reflections will appear here.'),...entries.map((e)=>Card(child:Padding(padding:const EdgeInsets.all(16),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[Text(e['date']!,style:const TextStyle(color:blue,fontWeight:FontWeight.w800)),const SizedBox(height:6),Text(e['learned']!),if(e['difficult']!.isNotEmpty)Text('Challenge: ${e['difficult']}'),if(e['next']!.isNotEmpty)Text('Next: ${e['next']}')]))))]);}
class JournalField extends StatelessWidget{final String label,hint;final TextEditingController controller;const JournalField({super.key,required this.label,required this.hint,required this.controller});@override Widget build(BuildContext context)=>Column(crossAxisAlignment:CrossAxisAlignment.start,children:[Text(label,style:const TextStyle(fontWeight:FontWeight.w800)),const SizedBox(height:7),TextField(controller:controller,minLines:2,maxLines:4,decoration:InputDecoration(hintText:hint))]);}

class ProfilePage extends StatefulWidget{const ProfilePage({super.key});@override State<ProfilePage> createState()=>_ProfilePageState();}
class _ProfilePageState extends State<ProfilePage>{
 final email=TextEditingController(),password=TextEditingController(),name=TextEditingController();
 bool register=false,busy=false,notificationsEnabled=false,reminderEnabled=false;TimeOfDay reminderTime=const TimeOfDay(hour:19,minute:0);String? avatarData,displayName;
 @override void initState(){super.initState();_loadNotificationPrefs();}
 Future<void> _loadNotificationPrefs()async{final p=await SharedPreferences.getInstance();if(!mounted)return;setState(()=>reminderEnabled=p.getBool('reminder_enabled')??false);final mins=p.getInt('reminder_minutes')??1140;reminderTime=TimeOfDay(hour:mins~/60,minute:mins%60);}
 @override void dispose(){email.dispose();password.dispose();name.dispose();super.dispose();}
 Future<void> _enableNotifications()async{try{final ok=await getLearnyNotifications.requestPermission();if(ok){await getLearnyNotifications.showTest();if(mounted)ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content:Text('Device notification sent.')));}else if(mounted)ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content:Text('Notification permission was not granted. Check Android settings.')));}catch(e){if(mounted)ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text('Notifications unavailable: $e')));}}
 Future<void> _testNotification()async{try{await getLearnyNotifications.showTest();}catch(e){if(mounted)ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text('$e')));}}
 Future<void> _pickReminderTime()async{final chosen=await showTimePicker(context:context,initialTime:reminderTime);if(chosen!=null&&mounted){setState(()=>reminderTime=chosen);if(reminderEnabled)await _saveReminder(true);}}
 Future<void> _saveReminder(bool value)async{final p=await SharedPreferences.getInstance();await p.setBool('reminder_enabled',value);await p.setInt('reminder_minutes',reminderTime.hour*60+reminderTime.minute);try{if(value){final ok=await getLearnyNotifications.requestPermission();if(!ok)throw Exception('Allow notifications in Android settings first');await getLearnyNotifications.scheduleDaily(reminderTime);}else{await getLearnyNotifications.cancelDaily();}if(mounted)setState(()=>reminderEnabled=value);}catch(e){if(mounted)ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text('$e')));}}
 Future<void> submit()async{if(apiBase.isEmpty){ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content:Text('Connect an API URL to create an account.')));return;}setState(()=>busy=true);try{final r=await ApiClient.request(register?'/auth/register':'/auth/login',method:'POST',body:{'email':email.text.trim(),'password':password.text,if(register)'name':name.text.trim()});ApiClient.token=r['token'];final p=await SharedPreferences.getInstance();await p.setString('token',r['token']);await p.setString('name',r['user']['name']??'Learner');avatarData=r['user']['avatar_data']?.toString();displayName=r['user']['name']?.toString();if(avatarData!=null)await p.setString('avatar_data',avatarData!);if(mounted)setState(()=>register=false);if(mounted)ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content:Text('Signed in successfully.')));}catch(e){if(mounted)ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text(e.toString().replaceFirst('Exception: ',''))));}finally{if(mounted)setState(()=>busy=false);}}
 Future<void> pickAvatar()async{if(ApiClient.token==null){ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content:Text('Sign in before uploading a profile picture.')));return;}try{final result=await FilePicker.platform.pickFiles(type:FileType.image,withData:true);if(result==null)return;final file=result.files.single;if(file.bytes==null)throw Exception('Could not read this image');if(file.size>2*1024*1024)throw Exception('Choose an image smaller than 2 MB');setState(()=>busy=true);final r=await ApiClient.upload('/profile/avatar',file);avatarData=r['user']['avatar_data']?.toString();final p=await SharedPreferences.getInstance();if(avatarData!=null)await p.setString('avatar_data',avatarData!);if(mounted)ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content:Text('Profile picture updated.')));}catch(e){if(mounted)ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text(e.toString().replaceFirst('Exception: ',''))));}finally{if(mounted)setState(()=>busy=false);}}
 @override Widget build(BuildContext context){return ListView(padding:const EdgeInsets.all(20),children:[
 const SectionTitle('Your profile'),const SizedBox(height:8),
 Container(padding:const EdgeInsets.all(20),decoration:BoxDecoration(gradient:const LinearGradient(colors:[ink,Color(0xFF7057F5)]),borderRadius:BorderRadius.circular(22)),child:Row(children:[CircleAvatar(radius:32,backgroundColor:gold,foregroundImage:avatarData!=null&&avatarData!.contains(',')?MemoryImage(base64Decode(avatarData!.split(',').last)):null,child:avatarData==null?const Icon(Icons.school_rounded,color:ink,size:30):null),const SizedBox(width:14),Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[Text(displayName??'GetLearny learner',style:const TextStyle(color:Colors.white,fontSize:18,fontWeight:FontWeight.w800)),const SizedBox(height:4),const Text('Your WASSCE preparation space',style:TextStyle(color:Colors.white70))])),IconButton(onPressed:busy?null:pickAvatar,tooltip:'Upload profile picture',icon:const Icon(Icons.add_a_photo_outlined,color:Colors.white))])),
 const SizedBox(height:20),Text(register?'Create your account':'Sign in to sync your progress',style:const TextStyle(fontSize:19,fontWeight:FontWeight.w900)),const SizedBox(height:12),
 if(register)...[TextField(controller:name,decoration:const InputDecoration(labelText:'Full name')),const SizedBox(height:10)],
 TextField(controller:email,keyboardType:TextInputType.emailAddress,decoration:const InputDecoration(labelText:'Email')),const SizedBox(height:10),
 TextField(controller:password,obscureText:true,decoration:const InputDecoration(labelText:'Password (8+ characters)')),const SizedBox(height:12),
 FilledButton(onPressed:busy?null:submit,child:Text(busy?'Please wait…':register?'Create account':'Sign in')),
 TextButton(onPressed:()=>setState(()=>register=!register),child:Text(register?'Already have an account? Sign in':'New here? Create an account')),
 const SizedBox(height:18),const Text('Appearance',style:TextStyle(fontWeight:FontWeight.w800)),SwitchListTile(contentPadding:EdgeInsets.zero,title:const Text('Dark mode'),subtitle:const Text('Use a darker theme in low-light settings'),value:darkModeNotifier.value,onChanged:(value)async{darkModeNotifier.value=value;final p=await SharedPreferences.getInstance();await p.setBool('dark_mode',value);setState((){});}),
 const SizedBox(height:20),const SectionTitle('Device notifications'),const SizedBox(height:8),Card(child:Padding(padding:const EdgeInsets.all(16),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[const Row(children:[Icon(Icons.notifications_active_outlined,color:blue,size:28),SizedBox(width:10),Expanded(child:Text('Notifications outside the app',style:TextStyle(fontWeight:FontWeight.w800,fontSize:16)))]),const SizedBox(height:8),const Text('Allow Android to show GetLearny alerts in the device notification shade.'),const SizedBox(height:10),Wrap(spacing:8,runSpacing:8,children:[FilledButton.icon(onPressed:_enableNotifications,icon:const Icon(Icons.notifications_active),label:const Text('Enable notifications')),OutlinedButton.icon(onPressed:_testNotification,icon:const Icon(Icons.send_outlined),label:const Text('Send test'))]),const Divider(height:24),SwitchListTile(contentPadding:EdgeInsets.zero,title:const Text('Daily study reminder'),subtitle:Text('Every day at ${reminderTime.format(context)}'),value:reminderEnabled,onChanged:_saveReminder),ListTile(contentPadding:EdgeInsets.zero,leading:const Icon(Icons.schedule),title:const Text('Reminder time'),subtitle:Text(reminderTime.format(context)),trailing:const Icon(Icons.edit_outlined),onTap:_pickReminderTime)]))),const SizedBox(height:12),const Text('Online learning service',style:TextStyle(fontWeight:FontWeight.w800)),const SizedBox(height:6),Text('API endpoint: $apiBase',style:const TextStyle(color:Colors.blueGrey))
 ]);}
}

class DocumentsPage extends StatefulWidget{const DocumentsPage({super.key});@override State<DocumentsPage> createState()=>_DocumentsPageState();}
class _DocumentsPageState extends State<DocumentsPage>{
 bool loading=false,uploading=false;String error='';List<Map<String,dynamic>> documents=[];
 @override void initState(){super.initState();load();}
 Future<void> load()async{if(ApiClient.token==null){setState(()=>error='Sign in from Profile to save and access your study files.');return;}setState(()=>loading=true);try{final r=await ApiClient.request('/documents');if(mounted)setState(()=>documents=(r['documents'] as List? ?? []).map((e)=>Map<String,dynamic>.from(e as Map)).toList());}catch(e){if(mounted)setState(()=>error=e.toString().replaceFirst('Exception: ',''));}finally{if(mounted)setState(()=>loading=false);}}
 Future<void> uploadFile()async{if(ApiClient.token==null){ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content:Text('Sign in before uploading files.')));return;}try{final result=await FilePicker.platform.pickFiles(type:FileType.custom,allowedExtensions:['pdf','txt'],withData:true);if(result==null)return;final file=result.files.single;if(file.bytes==null)throw Exception('Could not read the selected file');if(file.size>12*1024*1024)throw Exception('Choose a file smaller than 12 MB');setState(()=>uploading=true);final r=await ApiClient.upload('/documents',file);if(mounted)ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text(r['message']?.toString()??'Study material saved')));await load();}catch(e){if(mounted)ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text(e.toString().replaceFirst('Exception: ',''))));}finally{if(mounted)setState(()=>uploading=false);}}

 Future<void> askTutor(Map<String,dynamic> d)async{
  final controller=TextEditingController();
  final question=await showDialog<String>(context:context,builder:(ctx)=>AlertDialog(title:const Text('Ask the GetLearny tutor'),content:TextField(controller:controller,minLines:2,maxLines:4,maxLength:1000,decoration:const InputDecoration(hintText:'What would you like explained?',border:OutlineInputBorder())),actions:[TextButton(onPressed:()=>Navigator.pop(ctx),child:const Text('Cancel')),FilledButton(onPressed:()=>Navigator.pop(ctx,controller.text.trim()),child:const Text('Ask tutor'))]));
  if(question==null||question.length<3){controller.dispose();return;}
  try{final result=await ApiClient.request('/documents/${d['id']}/ask',method:'POST',body:{'question':question});if(!mounted)return;await showDialog<void>(context:context,builder:(ctx)=>AlertDialog(title:Text(result['source']?.toString()??'GetLearny tutor'),content:SingleChildScrollView(child:Text(result['answer']?.toString()??'No answer returned.')),actions:[TextButton(onPressed:()=>Navigator.pop(ctx),child:const Text('Done'))]));}
  catch(e){if(mounted)ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text(e.toString().replaceFirst('Exception: ',''))));}
  finally{controller.dispose();}
 }
 Future<void> download(Map<String,dynamic> d)async{try{final response=await http.get(Uri.parse('$apiBase/documents/${d['id']}'),headers:ApiClient.token==null?{}:{'Authorization':'Bearer ${ApiClient.token}'}).timeout(const Duration(seconds:25));if(response.statusCode<200||response.statusCode>=300)throw Exception('Could not retrieve this file');final path=await FilePicker.platform.saveFile(fileName:d['original_name']?.toString()??'study-material');if(path==null)return;await File(path).writeAsBytes(response.bodyBytes);if(mounted)ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content:Text('File saved to your device.')));}catch(e){if(mounted)ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text(e.toString().replaceFirst('Exception: ',''))));}}
 @override Widget build(BuildContext context)=>ListView(padding:const EdgeInsets.all(20),children:[const SectionTitle('Study materials'),const SizedBox(height:6),const Text('Upload PDFs and text notes, then access them from your account.'),const SizedBox(height:16),Card(child:Padding(padding:const EdgeInsets.all(18),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[const Icon(Icons.picture_as_pdf_outlined,size:34,color:blue),const SizedBox(height:8),const Text('Your study library',style:TextStyle(fontWeight:FontWeight.w900,fontSize:18)),const SizedBox(height:6),const Text('PDF or TXT · up to 12 MB per file'),const SizedBox(height:12),FilledButton.icon(onPressed:uploading?null:uploadFile,icon:const Icon(Icons.upload_file),label:Text(uploading?'Uploading…':'Choose and upload file'))]))),const SizedBox(height:20),Row(children:[const Expanded(child:SectionTitle('Your files')),IconButton(onPressed:loading?null:load,icon:const Icon(Icons.refresh))]),if(loading)const Center(child:Padding(padding:EdgeInsets.all(20),child:CircularProgressIndicator())),if(error.isNotEmpty)Padding(padding:const EdgeInsets.symmetric(vertical:8),child:Text(error,style:const TextStyle(color:Colors.deepOrange))),if(!loading&&documents.isEmpty&&error.isEmpty)const Text('Your uploaded study materials will appear here.'),...documents.map((d)=>Card(child:ListTile(leading:CircleAvatar(backgroundColor:mint,foregroundColor:ink,child:Icon(d['mime_type']=='application/pdf'?Icons.picture_as_pdf:Icons.description_outlined)),title:Text(d['original_name']?.toString()??'Study material',maxLines:2,overflow:TextOverflow.ellipsis),subtitle:Text('${((d['size_bytes'] as num? ?? 0)/1024).round()} KB · ${d['processing_status']??'saved'}'),trailing:Wrap(spacing:0,children:[if(d['processing_status']=='ready')IconButton(tooltip:'Ask the AI tutor',onPressed:()=>askTutor(d),icon:const Icon(Icons.auto_awesome_outlined,color:blue)),IconButton(tooltip:'Save file',onPressed:()=>download(d),icon:const Icon(Icons.download_outlined))]),onTap:()=>download(d))))]);
}

class SectionTitle extends StatelessWidget{final String text;const SectionTitle(this.text,{super.key});@override Widget build(BuildContext context)=>Text(text,style:const TextStyle(fontSize:20,fontWeight:FontWeight.w900,color:ink,letterSpacing:-.4));}
class StatCard extends StatelessWidget{final IconData icon;final String label,value;final Color tint;const StatCard({super.key,required this.icon,required this.label,required this.value,required this.tint});@override Widget build(BuildContext context)=>Container(padding:const EdgeInsets.all(12),decoration:BoxDecoration(color:Colors.white,borderRadius:BorderRadius.circular(18)),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[Container(padding:const EdgeInsets.all(7),decoration:BoxDecoration(color:tint,borderRadius:BorderRadius.circular(10)),child:Icon(icon,size:18,color:ink)),const SizedBox(height:12),Text(value,style:const TextStyle(fontSize:17,fontWeight:FontWeight.w900,color:ink)),const SizedBox(height:3),Text(label,style:const TextStyle(fontSize:10,color:Colors.blueGrey))]));}
class SubjectTile extends StatelessWidget{final String name;final IconData icon;final double progress;final VoidCallback onTap;const SubjectTile({super.key,required this.name,required this.icon,required this.progress,required this.onTap});@override Widget build(BuildContext context)=>Padding(padding:const EdgeInsets.only(bottom:10),child:Card(child:InkWell(borderRadius:BorderRadius.circular(20),onTap:onTap,child:Padding(padding:const EdgeInsets.all(14),child:Row(children:[Container(width:44,height:44,decoration:BoxDecoration(color:const Color(0xFFEFEDFF),borderRadius:BorderRadius.circular(13)),child:Icon(icon,color:blue)),const SizedBox(width:12),Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[Text(name,style:const TextStyle(fontWeight:FontWeight.w800,color:ink)),const SizedBox(height:8),ClipRRect(borderRadius:BorderRadius.circular(10),child:LinearProgressIndicator(value:progress,minHeight:6,backgroundColor:const Color(0xFFE8ECF3))) ])),const SizedBox(width:10),Text('${(progress*100).round()}%',style:const TextStyle(fontWeight:FontWeight.w800,color:blue))])))));}
