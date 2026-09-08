class Folder {
  final int id;
  final String name;
  final int sortOrder;

  const Folder({
    required this.id,
    required this.name,
    this.sortOrder = 0,
  });

  factory Folder.fromJson(Map<String, dynamic> j) => Folder(
        id: j['id'] as int,
        name: (j['name'] ?? '') as String,
        sortOrder: (j['sort_order'] ?? 0) as int,
      );

  Folder copyWith({String? name, int? sortOrder}) => Folder(
        id: id,
        name: name ?? this.name,
        sortOrder: sortOrder ?? this.sortOrder,
      );
}
